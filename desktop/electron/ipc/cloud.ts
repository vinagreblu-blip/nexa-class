import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAuth } from './auth';
import { getConfig, saveConfig, syncFromCloud, isCloudEnabled } from '../cloud';
import { getDb } from '../database';

function status(_event: IpcMainInvokeEvent): ApiResult<{ url: string; key: string; enabled: boolean }> {
  const config = getConfig();
  return { ok: true, data: { url: config.url, key: config.key ? '***' + config.key.slice(-4) : '', enabled: config.enabled } };
}

function salvar(
  _event: IpcMainInvokeEvent,
  _input: { url: string; key: string; enabled: boolean }
): ApiResult<true> {
  saveConfig();
  return { ok: true, data: true };
}

async function sync(_event: IpcMainInvokeEvent): Promise<ApiResult<{ synced: number }>> {
  if (!isCloudEnabled()) return { ok: false, error: 'Nuvem não ativada' };
  const result = await syncFromCloud(() => getDb());
  return { ok: true, data: result };
}

export function registrarCloudHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CLOUD_STATUS, requerAuth(status));
  ipcMain.handle(IPC_CHANNELS.CLOUD_SALVAR, requerAuth(salvar));
  ipcMain.handle(IPC_CHANNELS.CLOUD_SYNC, requerAuth(sync));
}
