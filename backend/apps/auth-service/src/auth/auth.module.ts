import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AUTH_TOKEN_PROVIDER } from './ports/token-provider.port';
import { JwtTokenProvider } from './providers/jwt-token.provider';

@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken]), JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    { provide: AUTH_TOKEN_PROVIDER, useClass: JwtTokenProvider },
  ],
  exports: [AUTH_TOKEN_PROVIDER],
})
export class AuthModule {}
