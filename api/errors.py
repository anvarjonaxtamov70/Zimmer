"""API xatolari va JSON javob formati."""

from aiohttp import web


class ApiError(Exception):
    """Mijozga tushunarli xato qaytarish uchun."""

    def __init__(self, status: int, code: str, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}

    def to_response(self) -> web.Response:
        body = {"ok": False, "error": {"code": self.code, "message": self.message}}
        if self.extra:
            body["error"].update(self.extra)
        return web.json_response(body, status=self.status)


def unauthorized() -> ApiError:
    return ApiError(
        401,
        "invalid_init_data",
        "Telegram ma'lumotlari tasdiqlanmadi. Ilovani Telegram orqali qayta ochib ko'ring.",
    )


def phone_required() -> ApiError:
    """Ilovaga kirish uchun emas — faqat buyurtma berish uchun telefon kerak."""
    return ApiError(
        428,
        "phone_required",
        "Buyurtmani rasmiylashtirish uchun telefon raqamingizni qoldiring.",
    )


def forbidden(message: str = "Bu bo'lim faqat adminlar uchun.") -> ApiError:
    return ApiError(403, "forbidden", message)


def bad_request(message: str, extra: dict | None = None) -> ApiError:
    return ApiError(400, "bad_request", message, extra)


def not_found(message: str = "Topilmadi") -> ApiError:
    return ApiError(404, "not_found", message)
