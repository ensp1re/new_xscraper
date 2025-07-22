import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { users, User, NewUser } from '../database/schema/users';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject('DRIZZLE_ORM')
    private readonly db,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const existingUser = await this.db.query.users.findFirst({
      where: (users) =>
        eq(users.username, createUserDto.username) ||
        eq(users.email, createUserDto.email),
    });

    if (existingUser) {
      throw new ConflictException('Username or email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const newUser: NewUser = {
      username: createUserDto.username,
      email: createUserDto.email,
      password: hashedPassword,
      isAdmin: createUserDto.isAdmin || false,
    };

    const [createdUser] = await this.db
      .insert(users)
      .values(newUser)
      .returning();
    return createdUser;
  }

  async findAll(): Promise<User[]> {
    return this.db.query.users.findMany({
      columns: {
        password: false,
      },
    });
  }

  async findOne(id: number): Promise<User> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByUsername(username: string): Promise<User> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.username, username),
    });
    if (!user) {
      throw new NotFoundException(`User with username ${username} not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }
    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updates: Partial<any> = {};

    if (updateUserDto.username) {
      updates.username = updateUserDto.username;
    }

    if (updateUserDto.email) {
      updates.email = updateUserDto.email;
    }

    if (updateUserDto.password) {
      updates.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    if (updateUserDto.isAdmin !== undefined) {
      updates.isAdmin = updateUserDto.isAdmin;
    }

    updates.updatedAt = new Date();

    const [updatedUser] = await this.db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();

    return updatedUser;
  }

  async remove(id: number): Promise<void> {
    const user = await this.findOne(id);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    await this.db.delete(users).where(eq(users.id, id));
  }
}
