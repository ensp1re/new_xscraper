import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Version,
  Request,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@ApiTags('api-keys')
@Controller('api-keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  private readonly logger = new Logger(ApiKeysController.name);

  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Version('1')
  @Post()
  @ApiOperation({ summary: 'Create a new API key' })
  @ApiResponse({ status: 201, description: 'API key created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Request() req, @Body() createApiKeyDto: CreateApiKeyDto) {
    this.logger.log(
      `Creating API key for user ID: ${req.user.id}, name: ${createApiKeyDto.name}`,
    );
    return this.apiKeysService.create(req.user.id, createApiKeyDto);
  }

  @Version('1')
  @Get()
  @ApiOperation({ summary: 'Get all API keys' })
  @ApiResponse({
    status: 200,
    description: 'Returns all API keys for the user',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Request() req) {
    this.logger.log(
      `Getting API keys for user ID: ${req.user.id}, isAdmin: ${req.user.isAdmin}`,
    );
    if (!req.user.isAdmin) {
      return this.apiKeysService.findAll(req.user.id);
    }
    return this.apiKeysService.findAll();
  }

  @Version('1')
  @Get(':id')
  @ApiOperation({ summary: 'Get an API key by ID' })
  @ApiResponse({ status: 200, description: 'Returns the API key' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  findOne(@Param('id') id: string) {
    this.logger.log(`Getting API key with ID: ${id}`);
    return this.apiKeysService.findOne(+id);
  }

  @Version('1')
  @Patch(':id')
  @ApiOperation({ summary: 'Update an API key' })
  @ApiResponse({ status: 200, description: 'API key updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  update(@Param('id') id: string, @Body() updateApiKeyDto: UpdateApiKeyDto) {
    this.logger.log(`Updating API key with ID: ${id}`);
    return this.apiKeysService.update(+id, updateApiKeyDto);
  }

  @Version('1')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an API key' })
  @ApiResponse({ status: 200, description: 'API key deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  remove(@Param('id') id: string) {
    this.logger.log(`Deleting API key with ID: ${id}`);
    return this.apiKeysService.remove(+id);
  }

  @Version('1')
  @Get('admin/all')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get all API keys (admin only)' })
  @ApiResponse({ status: 200, description: 'Returns all API keys' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  findAllAdmin() {
    this.logger.log('Admin getting all API keys');
    return this.apiKeysService.findAll();
  }
}
