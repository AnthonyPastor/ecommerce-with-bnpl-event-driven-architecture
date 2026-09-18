import { Module } from '@nestjs/common';
import { ProxyModule } from '@gateway/proxy/proxy.module';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [ProxyModule],
  controllers: [CatalogController],
})
export class CatalogModule {}
