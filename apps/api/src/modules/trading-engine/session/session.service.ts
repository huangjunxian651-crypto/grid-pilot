import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(options?: { state?: string; limit?: number; offset?: number }) {
    const where = options?.state ? { state: options.state } : undefined;
    const take = options?.limit ?? 50;
    const skip = options?.offset ?? 0;

    const [data, total] = await Promise.all([
      this.prisma.run.findMany({
        where,
        include: {
          box: {
            include: {
              account: {
                select: {
                  exchangeId: true,
                  accountId: true,
                  label: true,
                },
              },
            },
          },
        },
        orderBy: { startedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.run.count({ where }),
    ]);

    return { data, total, limit: take, offset: skip };
  }

  async findOne(id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: {
        box: {
          include: {
            account: {
              select: {
                exchangeId: true,
                accountId: true,
                label: true,
              },
            },
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`Run ${id} not found`);
    }

    return run;
  }

  async findOrders(runId: string) {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      select: { id: true },
    });

    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    return this.prisma.order.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    boxId: string;
    runCode: string;
    state: string;
  }) {
    return this.prisma.run.create({
      data,
      include: {
        box: {
          include: {
            account: {
              select: {
                exchangeId: true,
                accountId: true,
                label: true,
              },
            },
          },
        },
      },
    });
  }
}
