from aiogram import Router

from handlers import admin, cart, fallback, orders, queue, shop, start


def get_routers() -> list[Router]:
    """Routerlar tartibi muhim: fallback eng oxirida turadi."""
    return [
        start.router,
        queue.router,
        shop.router,
        cart.router,
        orders.router,
        admin.router,
        fallback.router,
    ]
