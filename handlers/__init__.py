"""Bot handlerlari.

`get_routers()` ichida import qilinadi — shu sababli `handlers.admin_schema`
kabi sof modullarni aiogram o'rnatilmagan muhitda ham (masalan testlarda)
import qilish mumkin.
"""


def get_routers() -> list:
    """Routerlar tartibi muhim: fallback eng oxirida turadi."""
    from handlers import admin, admin_crud, cart, fallback, orders, queue, shop, start

    return [
        start.router,
        queue.router,
        shop.router,
        cart.router,
        orders.router,
        admin.router,
        admin_crud.router,
        fallback.router,
    ]
