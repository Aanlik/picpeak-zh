/** Maintenance responses still switch the public app into the maintenance screen. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { api, setMaintenanceModeCallback } from '../api';

const originalAdapter = api.defaults.adapter;

function answer(status: number, data: unknown) {
  const adapter: AxiosAdapter = async (config) => {
    throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_RESPONSE, config, {}, {
      status, statusText: '', headers: {}, config: config as InternalAxiosRequestConfig, data,
    });
  };
  api.defaults.adapter = adapter;
}

describe('api 503 handling', () => {
  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  it('still switches to maintenance for a maintenance 503', async () => {
    const onMaintenance = vi.fn();
    setMaintenanceModeCallback(onMaintenance);
    answer(503, { error: 'Service Unavailable', maintenance: true });

    await expect(api.get('/public/settings')).rejects.toBeTruthy();
    expect(onMaintenance).toHaveBeenCalledWith(true);
  });
});
