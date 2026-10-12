// app.mjs — сборка: db -> repositories -> services -> api
import { Database } from './db.mjs';
import { TaskRepository, SettingsRepository, ProfileRepository, SessionRepository } from './repositories.mjs';
import {
  TaskService, CalendarService, SettingsService, StatisticsService, BackupService,
  ProfileService,
} from './services.mjs';
import { buildApi, handleApi } from './api.mjs';

export function initApi({ dataDir }) {
  const db = new Database(dataDir);
  // userId по умолчанию = 1 (единственный пользователь приложения).
  // Все репозитории получают userId на этапе конструктора, чтобы не таскать его через весь pipeline.
  const userId = 1;

  const taskRepo = new TaskRepository(db.db);
  taskRepo.userId = userId;
  const settingsRepo = new SettingsRepository(db.db);
  settingsRepo.userId = userId;
  const profileRepo = new ProfileRepository(db.db);
  profileRepo.userId = userId;
  const sessionRepo = new SessionRepository(db.db);

  const taskService = new TaskService(taskRepo, settingsRepo);
  const calendarService = new CalendarService(taskRepo);
  const settingsService = new SettingsService(settingsRepo);
  const profileService = new ProfileService(profileRepo);
  const statisticsService = new StatisticsService(taskRepo);
  const backupService = new BackupService(taskRepo, dataDir);

  const apiCtx = buildApi({
    taskService, calendarService, settingsService, statisticsService, backupService, profileService,
  });

  return {
    handle: (req, res, session) => handleApi(req, res, apiCtx, session).catch(err => {
      console.error('API error', err);
      apiCtx.send(res, 500, { error: 'internal' });
    }),
    sessionStore: sessionRepo,
  };
}