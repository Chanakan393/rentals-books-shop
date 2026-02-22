import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose'; // 🚀 เพิ่ม isValidObjectId
import { Rental, RentalDocument } from './entities/rental.entity';
import { Book, BookDocument } from '../books/entities/book.entity';
import { Payment, PaymentDocument } from '../payment/entities/payment.entity';

@Injectable()
export class RentalsService {
  findOverdueRentals() {
    throw new Error('Method not implemented.');
  }
  constructor(
    @InjectModel(Rental.name) private rentalModel: Model<RentalDocument>,
    @InjectModel(Book.name) private bookModel: Model<BookDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
  ) { }

  async rentBook(userId: string, bookId: string, days: number) {
    // 🚀 แก้ไข: ป้องกัน Error 500 หากส่ง ID ผิดรูปแบบ
    if (!isValidObjectId(bookId)) throw new BadRequestException('รหัสหนังสือไม่ถูกต้อง');
    
    if (![3, 5, 7].includes(days)) {
      throw new BadRequestException('เลือกจำนวนวันเช่าได้แค่ 3, 5 หรือ 7 วันเท่านั้น');
    }

    const book = await this.bookModel.findOneAndUpdate(
      { _id: bookId, "stock.available": { $gt: 0 }, status: 'Available' },
      { $inc: { "stock.available": -1 } },
      { new: true }
    );

    if (!book) throw new BadRequestException('หนังสือหมด หรือไม่พร้อมให้เช่า');

    let rentalCost = days === 3 ? book.pricing.day3 : days === 5 ? book.pricing.day5 : book.pricing.day7;
    const dueDate = new Date();
    dueDate.setDate(new Date().getDate() + days);

    const rental = new this.rentalModel({
      userId,
      bookId,
      borrowDate: new Date(),
      dueDate,
      cost: rentalCost,
      status: 'booked',
      paymentStatus: 'pending'
    });

    return rental.save();
  }

  async pickupBook(rentalId: string) {
    if (!isValidObjectId(rentalId)) throw new BadRequestException('รหัสรายการเช่าไม่ถูกต้อง');
    const rental = await this.rentalModel.findById(rentalId);
    if (!rental) throw new NotFoundException('ไม่พบรายการเช่านี้');

    if (rental.paymentStatus !== 'paid') {
      throw new BadRequestException('ยังไม่ได้จ่ายเงินหรือรอแอดมินตรวจสอบสลิป');
    }

    if (rental.status !== 'booked') {
      throw new BadRequestException('สถานะไม่ถูกต้องสำหรับการรับหนังสือ');
    }

    rental.status = 'rented';
    rental.borrowDate = new Date();
    return rental.save();
  }

  async returnBook(rentalId: string) {
    if (!isValidObjectId(rentalId)) throw new BadRequestException('รหัสรายการเช่าไม่ถูกต้อง');
    const rental = await this.rentalModel.findById(rentalId);
    if (!rental || rental.status !== 'rented') {
      throw new BadRequestException('รายการไม่ถูกต้อง หรือหนังสือไม่ได้อยู่ในสถานะกำลังเช่า');
    }

    const now = new Date();
    const dueDate = new Date(rental.dueDate);
    let fine = 0;

    if (now > dueDate) {
      const diffTime = Math.abs(now.getTime() - dueDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      fine = diffDays * 10;
    }

    const book = await this.bookModel.findById(rental.bookId);
    if (book) {
      const newAvailable = Math.min(book.stock.available + 1, book.stock.total);
      await this.bookModel.findByIdAndUpdate(rental.bookId, { "stock.available": newAvailable });
    }

    rental.status = 'returned';
    rental.returnDate = now;
    rental.fine = fine;

    return rental.save();
  }

  // 🚀 แก้ไข: รับ userId มาเพื่อตรวจว่าเป็นเจ้าของบิลไหม
  async cancelRental(rentalId: string, currentUserId: string) {
    if (!isValidObjectId(rentalId)) throw new BadRequestException('รหัสรายการเช่าไม่ถูกต้อง');
    
    const rental = await this.rentalModel.findById(rentalId);
    if (!rental) throw new NotFoundException('ไม่พบรายการเช่า');

    // 🚀 ป้องกันการแอบยกเลิกของคนอื่น (IDOR)
    if (rental.userId.toString() !== currentUserId) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์ยกเลิกรายการเช่าของผู้อื่น');
    }

    if (['rented', 'returned', 'cancelled'].includes(rental.status)) {
      throw new BadRequestException('ไม่สามารถยกเลิกได้เนื่องจากรับหนังสือไปแล้ว');
    }

    if (rental.paymentStatus !== 'pending' && rental.paymentStatus !== 'cancelled') {
      rental.paymentStatus = 'refund_verification';

      await this.paymentModel.findOneAndUpdate(
        { rentalId: rental._id.toString() }, 
        { $set: { status: 'refund_verification' } }
      ).exec();

    } else {
      rental.paymentStatus = 'cancelled';
    }

    rental.status = 'cancelled';

    const book = await this.bookModel.findById(rental.bookId);
    if (book) {
      const newAvailable = Math.min(book.stock.available + 1, book.stock.total);
      await this.bookModel.findByIdAndUpdate(rental.bookId, { "stock.available": newAvailable });
    }

    return rental.save();
  }

  async findMyHistory(userId: string) {
    return this.rentalModel.find({ userId })
      .populate('userId', 'username email phoneNumber address')
      .populate('bookId', 'title coverImage')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getDashboardReports(dateString?: string) {
    let query: any = {};
    if (dateString && dateString !== 'all') {
      const targetDate = new Date(dateString);
      const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
      query = { createdAt: { $gte: startOfDay, $lte: endOfDay } };
    }

    const transactions = await this.rentalModel.find(query)
      .populate('userId', 'username email')
      .populate('bookId', 'title coverImage')
      .sort({ createdAt: -1 })
      .exec();

    const activeBookings = await this.rentalModel.countDocuments({ ...query, status: 'booked' });
    const activeRentals = await this.rentalModel.countDocuments({ ...query, status: 'rented' });
    const overdueRentals = await this.rentalModel.countDocuments({
      ...query,
      status: 'rented',
      dueDate: { $lt: new Date() }
    });

    const revenue = transactions
      .filter(r => r.paymentStatus === 'paid' && r.status !== 'cancelled')
      .reduce((sum, r) => sum + r.cost, 0);

    return {
      summaryData: { activeBookings, activeRentals, overdueRentals, revenue },
      transactions
    };
  }
}