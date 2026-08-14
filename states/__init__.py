from aiogram.fsm.state import State, StatesGroup


class Register(StatesGroup):
    full_name = State()
    phone = State()


class Checkout(StatesGroup):
    delivery_method = State()
    address = State()
    phone = State()
    payment = State()
    confirm = State()


class Broadcast(StatesGroup):
    text = State()
