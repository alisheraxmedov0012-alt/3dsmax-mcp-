// @vitest-environment jsdom
/**
 * A3.3 — the AI panel's user-visible behaviour on failure.
 *
 * Two things are pinned here that no domain test can show:
 *
 * 1. Every failure path leaves the waiting state. A panel stuck on "Yaratilmoqda…"
 *    is the bug this stage exists to prevent.
 * 2. The offline fallback only runs when it can actually answer. It builds tables;
 *    a wardrobe prompt that fell back would report success for a request that was
 *    never understood.
 *
 * The network is mocked at `fetch`; nothing here calls a real provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiPromptPanel } from './AiPromptPanel';

const WORKING_LABEL = 'Yaratilmoqda…';
const IDLE_LABEL = 'AI orqali yaratish';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function specResponse(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'local',
    spec: {
      furniture: 'table',
      dimensions: { width_cm: 180, height_cm: 75, depth_cm: 60 },
      color: '#a9744f',
      material_kind: null,
      style: null,
      confidence: 'high',
      notes: [],
      warnings: [],
      supported: true,
      ...overrides,
    },
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderPanel() {
  const onApply = vi.fn();
  render(<AiPromptPanel onApply={onApply} />);
  return { onApply };
}

const textarea = () => screen.getByLabelText('Stol tavsifi') as HTMLTextAreaElement;
const button = () => screen.getByRole('button', { name: /AI orqali yaratish|Yaratilmoqda/ }) as HTMLButtonElement;

async function submit(text: string) {
  fireEvent.change(textarea(), { target: { value: text } });
  fireEvent.click(button());
}

/**
 * Wait until the panel shows a *settled* status message matching `pattern`.
 *
 * A `role="status"` element exists from the first render and already holds
 * "Tahlil qilinmoqda…" while the request is in flight. Waiting for the element
 * alone therefore returns immediately and the assertion after it races the
 * request, which is why this file used to fail intermittently on slow CI
 * runners. Waiting for the text keeps every check on the finished state.
 */
async function waitForStatus(pattern: RegExp) {
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(pattern));
}

describe('A3.3 panel — a timeout leaves the waiting state', () => {
  it('shows the button idle again and explains the deadline', async () => {
    // A real deadline, shortened through the documented env override, so the test
    // uses real timers: mixing fake timers with `waitFor` makes the wait itself
    // never advance. `resetModules` is required because the deadline is resolved
    // once when the client module loads.
    vi.resetModules();
    vi.stubEnv('VITE_AI_TIMEOUT_MS', '40');
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const { AiPromptPanel: FreshPanel } = await import('./AiPromptPanel');
    const onApply = vi.fn();
    render(<FreshPanel onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('Stol tavsifi') as HTMLTextAreaElement, {
      target: { value: '180x60x75 sm stol' },
    });
    fireEvent.click(screen.getByRole('button', { name: /AI orqali yaratish/ }));
    expect(screen.getByRole('button').textContent).toBe(WORKING_LABEL);

    // A table prompt still gets an answer from the offline rules, so this ends
    // as a status message, not an error — but it must name the timeout first.
    // Wait for the *finished* text: a role="status" element is also present while
    // the request is still running.
    await waitFor(
      () => expect(screen.getByRole('status').textContent).toMatch(/mahalliy qoidalar/),
      { timeout: 3000 },
    );
    // The waiting state is over: the button is usable and says so.
    expect(button().textContent).toBe(IDLE_LABEL);
    expect(button().disabled).toBe(false);
    // The message names the failure rather than claiming success.
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toMatch(/vaqtida javob bermadi/i);
    // A table prompt may still use the offline rules, and the result says so.
    expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null);
    expect(screen.getByRole('status').textContent).toMatch(/mahalliy qoidalar asosida/);
    vi.unstubAllEnvs();
  });
});

describe('A3.3 panel — server refusals are shown, not papered over', () => {
  it('shows the quota message and applies nothing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'limit_reached', message: 'Tarif limiti tugadi. Pro tarifga o‘ting.' } },
        402,
      ),
    );
    const { onApply } = renderPanel();

    await submit('180x60x75 sm stol');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Tarif limiti tugadi');
    // No offline substitution: the reader must see why nothing was created.
    expect(onApply).not.toHaveBeenCalled();
    expect(button().textContent).toBe(IDLE_LABEL);
  });

  it('shows an invalid-request message without falling back', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'ai_invalid_output', message: 'AI javobi tekshiruvdan o‘tmadi.' } },
        422,
      ),
    );
    const { onApply } = renderPanel();

    await submit('nimadir');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('tekshiruvdan');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows the image-not-supported message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'ai_image_not_supported',
            message: "Rasm tahlili hozircha qo'llab-quvvatlanmaydi.",
          },
        },
        422,
      ),
    );
    const { onApply } = renderPanel();

    await submit('rasmga o‘xshash stol');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/rasm tahlili/i);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('reports an unconfigured provider and still uses the offline analyzer for a table', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'ai_unconfigured', message: 'AI sozlanmagan.' } }, 503),
    );
    const { onApply } = renderPanel();

    await submit('180x60x75 sm stol');

    await waitForStatus(/sozlanmagan/i);
    expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null);
  });

  it('reports a provider outage and falls back for a table', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'ai_provider_error', message: 'Provayder xatosi.' } }, 502),
    );
    const { onApply } = renderPanel();

    await submit('180x60x75 sm stol');

    await waitForStatus(/provayderi javob bermadi/i);
    expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null);
  });

  it('reports the platform ceiling rather than retrying quietly', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'ai_capacity_reached', message: 'Umumiy chegara tugadi.' } },
        503,
      ),
    );
    const { onApply } = renderPanel();

    await submit('180x60x75 sm stol');

    await waitForStatus(/umumiy chegaraga yetdi/i);
    expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null);
  });
});

describe('A3.3 panel — the offline fallback refuses prompts it cannot answer', () => {
  it('does not turn a wardrobe prompt into a table', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'ai_provider_error', message: 'x' } }, 502),
    );
    const { onApply } = renderPanel();

    await submit('3 eshikli shkaf, 200 sm baland');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // Nothing was created, and the reason names the actual limitation.
    expect(onApply).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toMatch(/faqat stolni quradi/i);
    expect(alert).toMatch(/shkaf/i);
    expect(button().textContent).toBe(IDLE_LABEL);
  });

  it('does not turn a sofa prompt into a table either', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'ai_unconfigured', message: 'x' } }, 503),
    );
    const { onApply } = renderPanel();

    await submit('uch o‘rinli divan');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/divan/i);
  });

  it('still builds a table from a table prompt with no furniture word at all', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'ai_provider_error', message: 'x' } }, 502),
    );
    const { onApply } = renderPanel();

    await submit('180x60x75 sm, yog‘och rangli');

    await waitForStatus(/mahalliy qoidalar asosida/i);
    expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null);
  });
});

describe('A3.3 panel — the success path is unchanged', () => {
  it('applies a cloud result and reports its provider', async () => {
    fetchMock.mockResolvedValue(jsonResponse(specResponse()));
    const { onApply } = renderPanel();

    await submit('180x60x75 sm stol');

    await waitForStatus(/qo‘llanildi|qo'llanildi/);
    expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null);
    expect(button().textContent).toBe(IDLE_LABEL);
  });

  it('never shows an error when the request succeeds', async () => {
    fetchMock.mockResolvedValue(jsonResponse(specResponse({ furniture: 'wardrobe' })));
    renderPanel();

    await submit('3 eshikli shkaf');

    // Wait for the settled success message first: checking for the absence of an
    // alert while the request is still running would prove nothing.
    await waitForStatus(/qo‘llanildi|qo'llanildi/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('A3.4 F3 — the AI material reaches the model', () => {
  it('passes the PBR preset for a named material kind to the caller', async () => {
    fetchMock.mockResolvedValue(jsonResponse(specResponse({ material_kind: 'wood' })));
    const { onApply } = renderPanel();

    await submit('yog‘och stol');

    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith('table', expect.anything(), 'wood-oak'),
    );
  });

  it('passes null when the AI names no material, so the default is kept', async () => {
    fetchMock.mockResolvedValue(jsonResponse(specResponse({ material_kind: null })));
    const { onApply } = renderPanel();

    await submit('180x60x75 sm stol');

    await waitFor(() => expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null));
  });

  it('passes null for an unknown material kind instead of guessing', async () => {
    fetchMock.mockResolvedValue(jsonResponse(specResponse({ material_kind: 'carbon-fibre' })));
    const { onApply } = renderPanel();

    await submit('180x60x75 sm stol');

    await waitFor(() => expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null));
  });
});

describe('M8 — frontend-only build explains that no server AI exists', () => {
  it('skips the cloud request and labels the result as local rules', async () => {
    const onApply = vi.fn();
    render(<AiPromptPanel onApply={onApply} backendConfigured={false} />);

    expect(screen.getByTestId('ai-backend-unavailable').textContent).toMatch(
      /server AI ulanmagan/i,
    );

    await submit('180x60x75 sm stol');
    await waitForStatus(/mahalliy qoidalar asosida/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledWith('table', expect.anything(), null);
    expect(screen.getByRole('status').textContent).toMatch(
      /Server AI bu versiyada sozlanmagan/,
    );
  });

  it('refuses an unsupported type instead of reporting a successful local build', async () => {
    const onApply = vi.fn();
    render(<AiPromptPanel onApply={onApply} backendConfigured={false} />);

    await submit('3 eshikli shkaf, 200 sm baland');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/shkaf/i);
  });

  it('keeps the cloud hint when a backend is configured', () => {
    render(<AiPromptPanel onApply={vi.fn()} />);

    expect(screen.queryByTestId('ai-backend-unavailable')).toBeNull();
    expect(screen.getByText(/Serverda AI provayderi sozlangan bo/)).toBeTruthy();
  });
});
