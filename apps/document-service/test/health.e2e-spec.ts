import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
describe('Health endpoints (e2e)', () => {
  let app: INestApplication;
  beforeAll(async()=>{const ref=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue({isHealthy:jest.fn().mockResolvedValue(true)}).compile();app=ref.createNestApplication();await app.init();});
  afterAll(()=>app.close());
  it('GET /health/live',()=>request(app.getHttpServer()).get('/health/live').expect(200).expect(({body})=>expect(body).toMatchObject({status:'ok',service:'document-service'})));
  it('GET /health/ready',()=>request(app.getHttpServer()).get('/health/ready').expect(200).expect(({body})=>expect(body).toMatchObject({status:'ok',service:'document-service'})));
  it('returns correlation id',()=>request(app.getHttpServer()).get('/health/live').set('x-correlation-id','test-id').expect('x-correlation-id','test-id'));
});
