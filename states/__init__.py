from aiogram.fsm.state import State, StatesGroup


class Register(StatesGroup):
    full_name = State()
    phone = State()


class Checkout(StatesGroup):
    address = State()
    phone = State()
    confirm = State()


class AddService(StatesGroup):
    name = State()
    duration = State()
    price = State()


class AddCategory(StatesGroup):
    name = State()


class AddProduct(StatesGroup):
    category = State()
    name = State()
    description = State()
    price = State()
    stock = State()
    photo = State()


class Broadcast(StatesGroup):
    text = State()
