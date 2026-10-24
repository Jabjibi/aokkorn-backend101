import { HealthController } from '../../src/api/health/health.controller.js';
import type { DatabaseService } from '../../src/database/database.service.js';
describe('health/readiness', () => {
  it('checks the database and never leaks connection errors', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ value: 1 }] });
    const health = new HealthController({
      query,
    } as unknown as DatabaseService);
    expect(await health.check()).toEqual({ status: 'ok', database: 'up' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
    query.mockRejectedValue(new Error('postgresql://private-credentials'));
    await expect(health.check()).rejects.toMatchObject({
      errorCode: 'AOK-9000',
    });
    try {
      await health.check();
    } catch (error) {
      expect(String(error)).not.toContain('private-credentials');
    }
  });
});
