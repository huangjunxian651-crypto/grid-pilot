import { Controller, Get, Put, Delete, Body, UseGuards, Req } from "@nestjs/common";
import { Request } from "express";
import { ProfileService } from "./profile.service";
import { AuthGuard } from "../auth/auth.guard";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@UseGuards(AuthGuard)
@Controller("profile")
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @Get()
  getProfile(@Req() req: Request & { userId: string }) {
    return this.service.getProfile(req.userId);
  }

  @Put()
  updateProfile(@Req() req: Request & { userId: string }, @Body() data: UpdateProfileDto) {
    return this.service.updateProfile(req.userId, data);
  }

  @Delete()
  deleteAccount(@Req() req: Request & { userId: string }) {
    return this.service.deleteAccount(req.userId);
  }
}
