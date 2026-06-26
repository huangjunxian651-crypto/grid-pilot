import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from "@nestjs/common";
import { CredentialService } from "./credential.service";
import { AuthGuard } from "../auth/auth.guard";
import { CreateCredentialDto, UpdateCredentialDto } from "./dto/create-credential.dto";

@UseGuards(AuthGuard)
@Controller("credentials")
export class CredentialController {
  constructor(private readonly service: CredentialService) {}

  @Post()
  create(@Body() data: CreateCredentialDto) {
    return this.service.create(data);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOneMasked(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() data: UpdateCredentialDto,
  ) {
    return this.service.update(id, data);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
