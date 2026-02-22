import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose'; 
import { Book, BookDocument } from './entities/book.entity';
import { CreateBookDto } from './dto/create-book.dto';

@Injectable()
export class BooksService {
  constructor(@InjectModel(Book.name) private bookModel: Model<BookDocument>) { }

  // 🛡️ เพิ่มฟังก์ชันดักจับตัวเลขติดลบ (ป้องกันฝั่ง Service)
  private validateBookNumbers(data: any) {
    if (data.stock) {
      if (data.stock.total !== undefined && data.stock.total < 0) {
        throw new BadRequestException('สต็อกทั้งหมดต้องไม่ติดลบ');
      }
      if (data.stock.available !== undefined && data.stock.available < 0) {
        throw new BadRequestException('จำนวนหนังสือพร้อมใช้งานต้องไม่ติดลบ');
      }
    }
    if (data.pricing) {
      if (data.pricing.day3 !== undefined && data.pricing.day3 < 0) {
        throw new BadRequestException('ราคาเช่า 3 วันต้องไม่ติดลบ');
      }
      if (data.pricing.day5 !== undefined && data.pricing.day5 < 0) {
        throw new BadRequestException('ราคาเช่า 5 วันต้องไม่ติดลบ');
      }
      if (data.pricing.day7 !== undefined && data.pricing.day7 < 0) {
        throw new BadRequestException('ราคาเช่า 7 วันต้องไม่ติดลบ');
      }
    }
  }

  async create(createBookDto: CreateBookDto) {
    // 🚀 ดักจับเลขติดลบก่อนสร้างหนังสือใหม่
    this.validateBookNumbers(createBookDto);

    const newBook = new this.bookModel(createBookDto);
    return newBook.save();
  }

  async findAll(search: string) {
    const query = (typeof search === 'string' && search.trim() !== '')
      ? { title: { $regex: search, $options: 'i' } }
      : {};

    return this.bookModel.find(query).exec();
  }

  async findOne(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('รหัสหนังสือไม่ถูกต้อง');
    }
    const book = await this.bookModel.findById(id).exec();
    if (!book) throw new NotFoundException('ไม่พบข้อมูลหนังสือ');
    return book;
  }

  async findByTitle(title: string) {
    if (typeof title !== 'string') {
      throw new BadRequestException('Title must be a string');
    }
    return this.bookModel.find({ title: { $regex: title, $options: 'i' } }).exec();
  }

  async remove(id: string) {
    if (!isValidObjectId(id)) throw new BadRequestException('รหัสหนังสือไม่ถูกต้อง');
    const result = await this.bookModel.findByIdAndDelete(id).exec();

    if (!result) {
      throw new NotFoundException(`ไม่พบหนังสือรหัส ${id} ในระบบ`);
    }

    return { message: 'ลบข้อมูลหนังสือเรียบร้อยแล้ว', deletedBook: result.title };
  }

  async update(id: string, updateBookDto: any) {
    if (!isValidObjectId(id)) throw new BadRequestException('รหัสหนังสือไม่ถูกต้อง');
    
    // 🚀 ดักจับเลขติดลบก่อนอัปเดต
    this.validateBookNumbers(updateBookDto);

    if (updateBookDto.stock) {
      const book = await this.bookModel.findById(id);
      if (book) {
        // ดึงค่าเก่ามาใช้เทียบถ้าไม่มีการส่งค่าใหม่มา
        const newTotal = updateBookDto.stock.total !== undefined ? updateBookDto.stock.total : book.stock.total;
        const newAvailable = updateBookDto.stock.available !== undefined ? updateBookDto.stock.available : book.stock.available;

        if (newAvailable > newTotal) {
          throw new BadRequestException('จำนวนหนังสือพร้อมใช้งาน ห้ามมากกว่าสต็อกทั้งหมด');
        }
      }
    }

    const updatedBook = await this.bookModel.findByIdAndUpdate(
      id,
      updateBookDto,
      { returnDocument: 'after' }
    ).exec();

    if (!updatedBook) {
      throw new NotFoundException(`ไม่พบหนังสือรหัส ${id} เพื่อทำการแก้ไข`);
    }

    return updatedBook;
  }
}