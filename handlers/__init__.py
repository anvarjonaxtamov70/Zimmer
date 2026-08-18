"""Bot handlerlari.

`get_routers()` ichida import qilinadi — shu sababli `handlers.admin_schema`
kabi sof modullarni aiogram o'rnatilmagan muhitda ham (masalan testlarda)
import qilish mumkin.
"""


def get_routers() -> list:
    """Routerlar tartibi muhim: fallback eng oxirida turadi."""
    from handlers import (
        admin,
        admin_crud,
        admin_import,
        admin_products,
        cart,
        fallback,
        orders,
        queue,
        shop,
        start,
        stories,
    )

    return [
        start.router,
        queue.router,
        shop.router,
        cart.router,
        orders.router,
        admin.router,
        # Yangi Firebase products handlers (Avto_A1 style)
        admin_products.router,
        admin_import.router,
        # admin_crud dan KEYIN: tahrirlash oqimida yuborilgan rasm/video
        # avval o'sha oqimga tushishi kerak (u holat bilan filtrlangan).
        admin_crud.router,
        stories.router,
        fallback.router,
    ]
