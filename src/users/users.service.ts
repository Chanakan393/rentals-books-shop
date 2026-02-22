import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) { }

  private validateAndCleanPhoneNumber(phoneNumber: string): string {
    if (!phoneNumber) return '';
    
    const cleanPhone = phoneNumber.replace(/[- ]/g, '');
    const phoneRegex = /^(06|08|09)\d{8}$/;
    if (!phoneRegex.test(cleanPhone)) {
      throw new BadRequestException('เบอร์โทรศัพท์ไม่ถูกต้อง (ต้องขึ้นด้วย 06, 08, 09 และมี 10 หลักเท่านั้น)');
    }
    
    return cleanPhone;
  }

  private validateStringLengths(data: any) {
    if (data.username !== undefined) {
      const trimmedUsername = data.username.trim();
      if (typeof data.username !== 'string' || trimmedUsername.length < 1 || trimmedUsername.length > 20) {
        throw new BadRequestException('ชื่อผู้ใช้งานต้องเป็นข้อความและมีความยาว 1-20 ตัวอักษร');
      }
      if (/^\d+$/.test(trimmedUsername)) {
        throw new BadRequestException('ชื่อผู้ใช้งานไม่สามารถเป็นตัวเลขล้วนได้ กรุณาผสมตัวอักษรด้วย');
      }
    }
    if (data.password !== undefined) {
      if (typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 20) {
        throw new BadRequestException('รหัสผ่านต้องเป็นข้อความและมีความยาวระหว่าง 8 ถึง 20 ตัวอักษร');
      }
    }
    if (data.address !== undefined) {
      if (typeof data.address !== 'string' || data.address.trim().length < 10) {
        throw new BadRequestException('ที่อยู่ต้องเป็นข้อความและมีความยาวอย่างน้อย 10 ตัวอักษร');
      }
    }
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    let { email, password, username } = createUserDto;

    this.validateStringLengths(createUserDto);

    email = email.toLowerCase().trim();
    createUserDto.email = email;

    // 🚀 เพิ่ม: เช็คว่า Username ซ้ำไหม
    const usernameExists = await this.userModel.findOne({ username: username.trim() });
    if (usernameExists) {
      throw new BadRequestException('ชื่อผู้ใช้งาน (Username) นี้ถูกใช้งานไปแล้ว กรุณาใช้ชื่ออื่น');
    }

    // เช็คว่า Email ซ้ำไหม
    const emailExists = await this.userModel.findOne({ email });
    if (emailExists) {
      throw new BadRequestException('Email นี้ถูกใช้งานไปแล้ว');
    }

    if (createUserDto.phoneNumber) {
      createUserDto.phoneNumber = this.validateAndCleanPhoneNumber(createUserDto.phoneNumber);
      // เช็คเบอร์โทรศัพท์ซ้ำไหม
      const phoneExists = await this.userModel.findOne({ phoneNumber: createUserDto.phoneNumber });
      if (phoneExists) {
        throw new BadRequestException('เบอร์โทรศัพท์นี้ถูกใช้งานไปแล้ว');
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new this.userModel({
      ...createUserDto,
      password: hashedPassword,
      role: 'member',
    });

    return newUser.save();
  }

  async findByLogin(identifier: string): Promise<UserDocument | null> {
    const lowerIdentifier = identifier.toLowerCase().trim();
    
    return this.userModel.findOne({
      $or: [
        { email: lowerIdentifier },
        { username: identifier } 
      ]
    }).exec();
  }

  async findByIdWithRefresh(userId: string) {
    return this.userModel.findById(userId).select('+refreshTokenHash').exec();
  }

  async setRefreshTokenHash(userId: string, refreshTokenHash: string | null) {
    return this.userModel.updateOne({ _id: userId }, { refreshTokenHash }).exec();
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งาน');

    this.validateStringLengths(updateUserDto);

    // 🚀 เพิ่ม: เช็ค Username ซ้ำ ตอนแก้ไขโปรไฟล์
    if (updateUserDto.username && updateUserDto.username.trim() !== user.username) {
      const usernameExists = await this.userModel.findOne({ username: updateUserDto.username.trim() });
      if (usernameExists) throw new BadRequestException('ชื่อผู้ใช้งาน (Username) นี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว');
    }

    if (updateUserDto.email) {
      updateUserDto.email = updateUserDto.email.toLowerCase().trim();
      if (updateUserDto.email !== user.email) {
        const emailExists = await this.userModel.findOne({ email: updateUserDto.email });
        if (emailExists) throw new BadRequestException('Email นี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว');
      }
    }

    if (updateUserDto.phoneNumber) {
      updateUserDto.phoneNumber = this.validateAndCleanPhoneNumber(updateUserDto.phoneNumber);
      if (updateUserDto.phoneNumber !== user.phoneNumber) {
        const phoneExists = await this.userModel.findOne({ phoneNumber: updateUserDto.phoneNumber });
        if (phoneExists) throw new BadRequestException('เบอร์โทรศัพท์นี้ถูกใช้งานโดยผู้ใช้อื่นแล้ว');
      }
    }

    if (updateUserDto.password) {
      const salt = await bcrypt.genSalt(10);
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, salt);
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, { $set: updateUserDto }, { new: true })
      .select('-password -refreshTokenHash') 
      .exec();

    if (!updatedUser) {
      throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งาน');
    }
    return updatedUser;
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel
      .find({ role: 'member' })
      .select('-password -refreshTokenHash')
      .exec();
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel
      .findById(id)
      .select('-password -refreshTokenHash')
      .exec();

    if (!user) throw new BadRequestException('ไม่พบข้อมูลผู้ใช้งาน');
    return user;
  }
}