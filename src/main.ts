import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express'; // 🚀 เพิ่มตัวนี้
import { join } from 'path'; // 🚀 เพิ่มตัวนี้
import helmet from 'helmet';

async function bootstrap() {
  process.env.TZ = 'Asia/Bangkok';

  // ✅ เปลี่ยนมาใช้ NestExpressApplication เพื่อให้ใช้ useStaticAssets ได้
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  app.use(helmet({
    crossOriginResourcePolicy: false, // 🚀 ปิดเพื่อให้ Browser ยอมโหลดรูปจาก API
  }));
  
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  
  // ✅ เปิดให้เข้าถึงไฟล์ในโฟลเดอร์ uploads ผ่าน URL (เช่น /uploads/slips/xxx.jpg)
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  //เปลี่ยนจาก localhost
  const port = process.env.PORT || 3000; 
  await app.listen(port, '0.0.0.0');
}
bootstrap();