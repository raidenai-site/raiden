from abc import ABC, abstractmethod
from playwright.async_api import Page

class SocialPlatform(ABC):
    def __init__(self):
        self.page = None
        self.browser = None
        self.context = None

    @abstractmethod
    async def login(self) -> bool:
        pass

    @abstractmethod
    async def get_inbox(self) -> list:
        """Scrape the sidebar to get list of all chats"""
        pass

    @abstractmethod
    async def listen(self) -> None:
        pass

    @abstractmethod
    async def close(self) -> None:
        pass