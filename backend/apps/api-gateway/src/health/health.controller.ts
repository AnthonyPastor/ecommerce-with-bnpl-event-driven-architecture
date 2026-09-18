import { Controller, Get } from '@nestjs/common';
import { Public } from '@gateway/common/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}
