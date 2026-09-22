import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CreditProfile } from './entities/credit-profile.entity';

@Injectable()
export class CreditScoringService {
  constructor(
    @InjectRepository(CreditProfile) private readonly profiles: Repository<CreditProfile>,
  ) {}

  /**
   * Scoring stub: always approves. A real scoring implementation would
   * evaluate payment history, declared income, an external credit bureau,
   * etc. — this is the extension point for that, for the day the stub gets
   * replaced.
   */
  async scoreUser(_userId: string): Promise<{ approved: boolean }> {
    return { approved: true };
  }

  /** Pass `manager` (a use case's `queryRunner.manager`) to run as part of an existing transaction instead of its own. */
  async getOrCreateProfile(userId: string, manager?: EntityManager): Promise<CreditProfile> {
    const repo = manager ? manager.getRepository(CreditProfile) : this.profiles;
    const existing = await repo.findOne({ where: { userId } });
    if (existing) {
      return existing;
    }
    const created = repo.create({ userId, blocked: false, needsRescoring: false });
    return repo.save(created);
  }

  /** Pass `manager` (a use case's `queryRunner.manager`) to run as part of an existing transaction instead of its own. */
  async markNeedsRescoring(userId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(CreditProfile) : this.profiles;
    const profile = await this.getOrCreateProfile(userId, manager);
    profile.needsRescoring = true;
    await repo.save(profile);
  }

  /** Pass `manager` (a use case's `queryRunner.manager`) to run as part of an existing transaction instead of its own. */
  async markBlocked(userId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(CreditProfile) : this.profiles;
    const profile = await this.getOrCreateProfile(userId, manager);
    profile.blocked = true;
    await repo.save(profile);
  }
}
