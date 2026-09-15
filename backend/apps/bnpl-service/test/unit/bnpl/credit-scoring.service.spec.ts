import { CreditScoringService } from '../../../src/bnpl/credit-scoring.service';
import { CreditProfile } from '../../../src/bnpl/entities/credit-profile.entity';

function makeService(existing?: CreditProfile | null) {
  const repo = {
    findOne: jest.fn(async () => existing ?? null),
    create: jest.fn((data: any) => data),
    save: jest.fn(async (data: any) => ({ id: 'profile-1', ...data })),
  };
  const service = new CreditScoringService(repo as any);
  return { service, repo };
}

describe('CreditScoringService', () => {
  it('scoreUser always approves (stub)', async () => {
    const { service } = makeService();
    await expect(service.scoreUser('user-1')).resolves.toEqual({ approved: true });
  });

  it('getOrCreateProfile creates a new profile when none exists', async () => {
    const { service, repo } = makeService(null);
    const profile = await service.getOrCreateProfile('user-1');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', blocked: false }),
    );
    expect(profile.userId).toBe('user-1');
  });

  it('getOrCreateProfile returns the existing profile without creating a new one', async () => {
    const existing = { id: 'profile-1', userId: 'user-1', blocked: true } as CreditProfile;
    const { service, repo } = makeService(existing);
    const profile = await service.getOrCreateProfile('user-1');
    expect(profile).toBe(existing);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('markNeedsRescoring sets the flag and persists it', async () => {
    const existing = { id: 'profile-1', userId: 'user-1', needsRescoring: false } as CreditProfile;
    const { service, repo } = makeService(existing);

    await service.markNeedsRescoring('user-1');

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ needsRescoring: true }));
  });
});
