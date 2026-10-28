"""Errors in the same JSON shape as the Node API: {"error": {"code", "message", "field"}}."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, field: str | None = None, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.field, self.headers = status, code, message, field, headers


def unauthorized(message: str = "Authentication required") -> AppError:
    return AppError(401, "UNAUTHORIZED", message)


def forbidden(message: str = "You do not have permission to do that") -> AppError:
    return AppError(403, "FORBIDDEN", message)


def not_found(what: str = "Resource") -> AppError:
    return AppError(404, "NOT_FOUND", f"{what} not found")


def _body(code: str, message: str, field: str | None = None) -> dict:
    return {"error": {"code": code, "message": message, "field": field}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(_body(exc.code, exc.message, exc.field), status_code=exc.status, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        loc = [str(p) for p in first.get("loc", []) if p not in ("body", "query", "path")]
        msg = str(first.get("msg", "Invalid input")).removeprefix("Value error, ")
        return JSONResponse(_body("VALIDATION_ERROR", msg, ".".join(loc) or None), status_code=400)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception):
        import logging

        logging.getLogger("ai-service").exception("Unhandled error", exc_info=exc)
        return JSONResponse(_body("INTERNAL_ERROR", "Something went wrong"), status_code=500)
