type Pair = { fromCurrency: string; toCurrency: string };
type Result =
  | (Pair & { rate: string; capturedAt: string })
  | { error: 'unsupported' | 'unavailable' | 'invalid_response' };
/** Lambda adapter เท่านั้น: คู่สกุล → decimal string/date; ไม่มีสิทธิ์ DB/session และไม่คำนวณยอดเงิน */
export async function handler(event: Pair): Promise<Result> {
  if (
    !event ||
    !/^[A-Z]{3}$/.test(event.fromCurrency) ||
    !/^[A-Z]{3}$/.test(event.toCurrency) ||
    event.fromCurrency === event.toCurrency
  )
    return { error: 'unsupported' };
  let response: Response;
  try {
    response = await fetch(
      `https://api.frankfurter.dev/v2/rate/${event.fromCurrency.toLowerCase()}/${event.toCurrency.toLowerCase()}`,
      {
        signal: AbortSignal.timeout(4500),
        redirect: 'error',
        headers: { Accept: 'application/json' },
      },
    );
  } catch {
    return { error: 'unavailable' };
  }
  if (response.status === 404 || response.status === 422)
    return { error: 'unsupported' };
  if (response.status === 429 || response.status >= 500)
    return { error: 'unavailable' };
  if (!response.ok || !response.body) return { error: 'invalid_response' };
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16384) throw new Error();
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(bytes);
    const body = JSON.parse(text) as {
      base?: string;
      quote?: string;
      date?: string;
      rate?: unknown;
    };
    // อ่าน numeric token จาก raw JSON โดยตรง ไม่ผ่าน Number → string เพื่อไม่ทำอัตราเสีย precision
    const token =
      typeof body.rate === 'string'
        ? body.rate
        : /"rate"\s*:\s*([0-9]+(?:\.[0-9]+)?)(?=\s*[,}])/.exec(text)?.[1];
    if (
      !token ||
      !/^[0-9]+(?:\.[0-9]+)?$/.test(token) ||
      body.base?.toUpperCase() !== event.fromCurrency ||
      body.quote?.toUpperCase() !== event.toCurrency ||
      !body.date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
    )
      return { error: 'invalid_response' };
    const capturedAt = new Date(`${body.date}T00:00:00.000Z`).toISOString();
    return { ...event, rate: token, capturedAt };
  } catch {
    return { error: 'invalid_response' };
  }
}
