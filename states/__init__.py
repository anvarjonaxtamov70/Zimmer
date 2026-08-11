from aiogram.fsm.state import State, StatesGroup


class Register(StatesGroup):
    full_name = State()
    phone = State()


class Checkout(StatesGroup):
    address = State()
    phone = State()
    confirm = State()


class Broadcast(StatesGroup):
    text = State()
