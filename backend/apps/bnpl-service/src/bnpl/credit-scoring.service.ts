import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async getOrCreateProfile(userId: string): Promise<CreditProfile> {
    const existing = await this.profiles.findOne({ where: { userId } });
    if (existing) {
      return existing;
    }
    const created = this.profiles.create({ userId, blocked: false, needsRescoring: false });
    return this.profiles.save(created);
  }

  async markNeedsRescoring(userId: string): Promise<void> {
    const profile = await this.getOrCreateProfile(userId);
    profile.needsRescoring = true;
    await this.profiles.save(profile);
  }
}
