import { participantInput } from '../../src/api/participants/participants.dto.js';
describe('participant input contract', () => {
  it('accepts a name and rejects ownership/system fields', () => {
    expect(participantInput({ displayName: '  เพื่อน  ' })).toEqual({
      displayName: 'เพื่อน',
    });
    expect(() =>
      participantInput({ displayName: 'เพื่อน', isOwner: true }),
    ).toThrow(expect.objectContaining({ errorCode: 'AOK-9001' }));
  });
  it.each([
    ['', 'AOK-3101'],
    ['x'.repeat(81), 'AOK-3102'],
  ])('reports name error %s', (displayName, errorCode) => {
    expect(() => participantInput({ displayName })).toThrow(
      expect.objectContaining({ errorCode }),
    );
  });
});
