import dayjs from 'dayjs';
import { isDate } from 'lodash-es';
import schedule, { RecurrenceRule } from 'node-schedule';
import { Maybe } from '../types/util.js';
import { Logger, LoggerFactory } from '../util/logging/LoggerFactory.js';
import { Task } from './Task.js';

type ScheduleRule = RecurrenceRule | Date | string | number;

export type TaskFactoryFn<T> = () => Task<T>;

type ScheduledTaskOptions = {
  visible?: boolean;
  runOnSchedule?: boolean;
  runAtStartup?: boolean;
};

export class ScheduledTask<OutType = unknown> {
  protected logger: Logger;
  protected scheduledJob: schedule.Job;

  private factory: TaskFactoryFn<OutType>;
  private schedule: ScheduleRule;

  public running: boolean = false;
  public runAtStartup = false;
  public visible: boolean = true;
  public lastExecution?: Date;

  constructor(
    jobName: string,
    scheduleRule: ScheduleRule,
    taskFactory: TaskFactoryFn<OutType>,
    options?: ScheduledTaskOptions,
  ) {
    this.logger = LoggerFactory.child({
      task: jobName,
      className: this.constructor.name,
      caller: import.meta,
    });
    this.schedule = scheduleRule;
    this.factory = taskFactory;
    this.scheduledJob = schedule.scheduleJob(jobName, scheduleRule, () =>
      this.jobInternal(),
    );

    this.visible = options?.visible ?? true;

    if (options?.runOnSchedule) {
      schedule.scheduleJob(jobName, dayjs().add(5, 'seconds').toDate(), () =>
        this.jobInternal(),
      );
    }

    if (options?.runAtStartup) {
      this.runAtStartup = options.runAtStartup;
    }
  }

  get name() {
    return this.scheduledJob.name;
  }

  // Runs an instance of this task now, cancels the next invocation
  // and reschedules the job on the original schedule.
  // If background=true, this function will not return the underlying
  // Promise generated by the running job and all errors will be swallowed.
  async runNow(background: boolean = true) {
    this.scheduledJob.cancelNext(false);
    // Can't reschedule a one-off job
    const rescheduleCb = () =>
      isDate(this.schedule)
        ? void 0
        : this.scheduledJob.reschedule(this.schedule);
    if (background) {
      return new Promise<Maybe<OutType>>((resolve, reject) => {
        this.jobInternal().then(resolve).catch(reject).finally(rescheduleCb);
      });
    } else {
      return this.jobInternal(true).finally(rescheduleCb);
    }
  }

  cancel(reschedule: boolean = false) {
    this.scheduledJob.cancel(reschedule);
  }

  removeFromSchedule() {
    this.cancel(false);
  }

  nextExecution() {
    return this.scheduledJob.nextInvocation();
  }

  private async jobInternal(rethrow: boolean = false) {
    this.running = true;
    const instance = this.factory();
    try {
      return await instance.run();
    } catch (e) {
      this.logger.error(e, 'Error while running job: %s', instance.taskName);
      if (rethrow) throw e;
      return;
    } finally {
      this.running = false;
      this.lastExecution = new Date();
    }
  }
}
