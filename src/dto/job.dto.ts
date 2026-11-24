import {
  Max,
  Min,
  IsIn,
  IsInt,
  Equals,
  Matches,
  IsObject,
} from 'class-validator';

import { WORKER } from '../constants/worker.constant.js';
import type { WorkerJobType } from '../interfaces/worker.interface.js';

export class JobDto {
  @Equals(WORKER.VERSION)
  declare version: number;

  @Matches(/^[a-zA-Z0-9_-]{1,128}$/)
  declare jobId: string;

  @Matches(/^[a-zA-Z0-9_-]{1,128}$/)
  declare tenantId: string;

  @IsIn([WORKER.JOB_TYPE, WORKER.PDF_JOB_TYPE])
  declare jobType: WorkerJobType;

  @IsInt()
  @Min(1)
  @Max(WORKER.MAX_ATTEMPTS)
  declare attempt: number;

  @IsObject()
  declare payload: object;
}
