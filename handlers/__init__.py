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
        admin_product_actions,
        ai_chat,
        cart,
        fallback,
        music,
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
        admin_product_actions.router,  # Product card callback handlers
        admin_import.router,
        # admin_crud dan KEYIN: tahrirlash oqimida yuborilgan rasm/video
        # avval o'sha oqimga tushishi kerak (u holat bilan filtrlangan).
        admin_crud.router,
        stories.router,
        # Fon musiqasi: admin audio tashlaydi. `F.audio` boshqa hech qayerda
        # ushlanmaydi, shuning uchun to'qnashuv yo'q — lekin AI'dan OLDIN
        # turishi kerak (AI matnli xabarlarni oladi, audio esa shu yerga).
        music.router,
        # ---- AI yordamchi ----
        #
        # `fallback` DAN OLDIN, qolgan hammasidan KEYIN.
        #
        # Sabab: `fallback` — «Tushunmadim» javobi, ya'ni hech kim
        # ushlamagan xabar. AI aynan o'shalarni olishi kerak. Agar
        # oldinroq tursa menyu tugmalari va admin oqimlarini o'ziga
        # tortib olardi; `fallback` dan keyin tursa esa umuman navbatga
        # yetib kelmasdi (aiogram birinchi mos handler'da to'xtaydi).
        #
        # AI o'chirilgan yoki javob bermaydigan holatda handler
        # `fallback` funksiyasini O'ZI chaqiradi — shu tufayli mijoz
        # har holatda javob oladi.
        ai_chat.router,
        fallback.router,
    ]
