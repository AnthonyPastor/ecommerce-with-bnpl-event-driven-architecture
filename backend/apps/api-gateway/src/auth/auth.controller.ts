import { All, Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '@gateway/common/public.decorator';
import { ProxyService } from '@gateway/proxy/proxy.service';

/** auth-service keeps its own /auth/... prefix, so strip only /api. Register/login/refresh are public; everything else needs a JWT. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly proxy: ProxyService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  register(@Req() req: Request, @Res() res: Response): void {
    this.forward(req, res);
  }

  @Public()
  @Post('login')
  login(@Req() req: Request, @Res() res: Response): void {
    this.forward(req, res);
  }

  @Public()
  @Post('refresh')
  refresh(@Req() req: Request, @Res() res: Response): void {
    this.forward(req, res);
  }

  @All(['/', '*'])
  proxyRest(@Req() req: Request, @Res() res: Response): void {
    this.forward(req, res);
  }

  private forward(req: Request, res: Response): void {
    this.proxy.forward(req, res, {
      target: this.config.get<string>('AUTH_SERVICE_URL', 'http://localhost:3001'),
      stripPrefix: '^/api',
    });
  }
}
