import os
from pathlib import Path


class Settings:
    ENV: str = os.getenv("ENV", "development")
    DB_PATH: str = os.getenv("DB_PATH", str(Path(__file__).parent.parent.parent / "data" / "hotline.db"))
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "CHANGE_ME_IN_PRODUCTION")
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))

    # Background worker settings
    SPAM_WORKER_INTERVAL_SECONDS: int = 60
    SPAM_WORKER_BATCH_SIZE: int = 20

    # OpenRouter model for spam filtering (optional)
    OPENROUTER_MODEL: str = "openai/gpt-5-nano"


settings = Settings()
