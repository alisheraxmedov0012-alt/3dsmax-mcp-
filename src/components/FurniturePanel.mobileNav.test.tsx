// @vitest-environment jsdom
/**
 * M2 — mobile panel navigation. Sections stay mounted; CSS only reveals the
 * active group, so switching tabs must not reset local values.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FurniturePanel } from './FurniturePanel';

function renderMobilePanel() {
  const result = render(
    <FurniturePanel
      object={null}
      values={{ color: '#a9744f' }}
      errors={{}}
      onChange={() => {}}
      onReset={() => {}}
      onAdd={() => {}}
      mobileSections
    >
      <div className="panel__section" data-section="scene">
        <p>Scene content</p>
      </div>
      <div className="panel__section" data-section="objects">
        <label htmlFor="mobile-note">Nomi</label>
        <input id="mobile-note" defaultValue="saqlangan qiymat" />
      </div>
      <div className="panel__section" data-section="materials">
        <p>Material content</p>
      </div>
      <div className="panel__section" data-section="ai">
        <p>AI content</p>
      </div>
      <div className="panel__section" data-section="export">
        <p>Export content</p>
      </div>
      <div className="panel__section" data-section="other">
        <p>Other content</p>
      </div>
    </FurniturePanel>,
  );
  return { ...result, panel: result.container.querySelector('.panel') as HTMLElement };
}

afterEach(() => {
  cleanup();
});

describe('M2 mobile panel navigation', () => {
  it('renders the six sections with Obyektlar active by default', () => {
    const { panel } = renderMobilePanel();

    for (const label of ['Sahna', 'Obyektlar', 'Materiallar', 'AI', 'Eksport', 'Boshqa']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(panel.getAttribute('data-mobile-section')).toBe('objects');
    expect(screen.getByRole('button', { name: 'Obyektlar' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Sahna' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps every section mounted when the active tab changes', () => {
    const { panel } = renderMobilePanel();

    fireEvent.click(screen.getByRole('button', { name: 'Sahna' }));
    expect(panel.getAttribute('data-mobile-section')).toBe('scene');
    expect(screen.getByRole('button', { name: 'Sahna' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Obyektlar' }).getAttribute('aria-pressed')).toBe(
      'false',
    );

    expect(screen.getByText('Scene content')).toBeTruthy();
    expect(screen.getByText('Material content')).toBeTruthy();
    expect(screen.getByText('AI content')).toBeTruthy();
    expect(screen.getByText('Export content')).toBeTruthy();
    expect(screen.getByText('Other content')).toBeTruthy();
  });

  it('preserves values entered in one section while another is open', () => {
    renderMobilePanel();
    const input = screen.getByLabelText('Nomi') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'yangi qiymat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sahna' }));
    fireEvent.click(screen.getByRole('button', { name: 'Obyektlar' }));

    expect((screen.getByLabelText('Nomi') as HTMLInputElement).value).toBe('yangi qiymat');
  });

  it('does not render the mobile nav when the caller does not enable it', () => {
    render(
      <FurniturePanel
        object={null}
        values={{ color: '#a9744f' }}
        errors={{}}
        onChange={() => {}}
        onReset={() => {}}
        onAdd={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Sahna' })).toBeNull();
  });
});
