import { Module } from '@nestjs/common';
import { ProxyModule } from '@gateway/proxy/proxy.module';
import { AuthController } from './auth.controller';

@Module({
  imports: [ProxyModule],
  controllers: [AuthController],
})
export class AuthModule {}
