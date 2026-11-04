/**
 * Stage 3.5 fix — one place for user-facing usage warnings.
 *
 * A usage problem never replaces the AI result; it is shown next to it, in plain
 * language, and it says explicitly when a recorded zero is *not* a measured zero.
 */
import type { BudgetErrorCode } from './types';

export function usageWarningMessage(code: BudgetErrorCode | undefined): string | null {
  switch (code) {
    case 'invalid_usage_data':
      return "AI foydalanish ma'lumotlari noto'g'ri — bu so'rov uchun token va xarajat 0 deb yozildi. Bu haqiqiy sarf 0 bo'lganini anglatmaydi.";
    case 'provider_usage_unavailable':
      return "Provayder token ma'lumotini qaytarmadi — bu so'rovning sarfi hisobga olinmagan bo'lishi mumkin.";
    case 'usage_persistence_failed':
      return "Foydalanish statistikasi saqlanmadi — hisob faqat shu sessiyada qoladi.";
    default:
      return null;
  }
}
