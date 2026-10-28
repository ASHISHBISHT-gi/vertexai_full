import os

# The settings need these to exist; no test here touches a real database or AI service.
os.environ.setdefault("DATABASE_URL", "postgresql://unused:unused@localhost/unused")
os.environ.setdefault("JWT_ACCESS_SECRET", "test-secret-test-secret-test-secret")
