"""Token pricing for the AI provider (A3.4 F4/F10).

Prices are configuration, never constants in code: a price hard-coded here would
become a real-looking number that nobody confirmed, and the ledger would report
an invented cost as if it were invoiced. When no price is configured the cost
stays unknown — the ledger already stores ``cost_kind="unknown"`` with null cost
columns for exactly that case.

Prices are expressed in **micros** (1e-6 of the currency unit) per 1000 tokens,
so ``150`` means 0.00015 per 1000 tokens, i.e. 0.15 per 1,000,000 tokens. This
keeps the arithmetic in integers, the same unit the ledger stores.
"""
from __future__ import annotations

from dataclasses import dataclass

#: A cost derived from configured prices is an estimate, not an invoice: the
#: provider's actual bill also depends on cached tokens, reasoning tokens and
#: per-account discounts we cannot see.
COST_KIND_FOR_ESTIMATE = "estimated"


@dataclass(frozen=True)
class TokenPrices:
    """Configured price per 1000 tokens, in micros, for one currency."""

    input_micros_per_1k: int
    output_micros_per_1k: int
    currency: str

    def estimate_micros(self, prompt_tokens: int | None, completion_tokens: int | None) -> int | None:
        """Cost in micros, or ``None`` when the token counts are not both known.

        A missing count is never treated as zero: doing so would silently
        under-report a real charge.
        """
        if prompt_tokens is None or completion_tokens is None:
            return None
        if prompt_tokens < 0 or completion_tokens < 0:
            return None
        prompt_micros = prompt_tokens * self.input_micros_per_1k
        completion_micros = completion_tokens * self.output_micros_per_1k
        return (prompt_micros + completion_micros + 500) // 1000


def token_prices_from_settings(settings) -> TokenPrices | None:
    """Prices from configuration, or ``None`` when they are not fully specified.

    Both prices and the currency are required: a cost without a currency cannot
    be compared with anything, and half a price would produce a wrong number.
    """
    input_price = settings.ai_price_input_micros_per_1k
    output_price = settings.ai_price_output_micros_per_1k
    currency = (settings.ai_price_currency or "").strip()
    if input_price is None or output_price is None or not currency:
        return None
    if input_price < 0 or output_price < 0:
        return None
    return TokenPrices(
        input_micros_per_1k=int(input_price),
        output_micros_per_1k=int(output_price),
        currency=currency,
    )


__all__ = ["COST_KIND_FOR_ESTIMATE", "TokenPrices", "token_prices_from_settings"]
