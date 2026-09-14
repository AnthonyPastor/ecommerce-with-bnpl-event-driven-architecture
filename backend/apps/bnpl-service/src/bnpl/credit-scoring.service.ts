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
   * Stub de scoring: siempre aprueba. Un scoring real evaluaría historial de
   * pagos, ingresos declarados, buró de crédito externo, etc. — este es el
   * punto de extensión para eso el día que se reemplace el stub.
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
