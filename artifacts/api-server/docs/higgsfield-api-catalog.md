# Higgsfield API — каталог для разработки

Снимок официальной документации на **23 октября 2026**. Это справочник для выбора сценария и проверки параметров при разработке; ссылки на схемы ниже — источник истины для обязательности полей, типов, ограничений и форматов.

## Объём и ограничения

- В официальном каталоге генерации описано **84 workflow**: **67 видео** и **17 изображений**.
- Список не означает, что все модели включены в аккаунт или доступны по его тарифу. Доступность и стоимость нужно проверять в аккаунте Higgsfield.
- OpenAPI-файл полезен как дополнительная техническая справка, но сами docs предупреждают, что он не исчерпывает каталог. Отсутствие маршрута в OpenAPI не доказывает, что его нет в продукте.
- Страницы workflow ниже содержат полные схемы запросов и примеры. Не копируйте значения по умолчанию в приложение без сверки с текущей схемой.

## Общие ссылки

- [Каталог моделей](https://docs.higgsfield.ai/docs/models)
- [Видео API](https://docs.higgsfield.ai/docs/models/video-generation)
- [Изображения API](https://docs.higgsfield.ai/docs/models/image-generation)
- [Официальный SDK](https://docs.higgsfield.ai/docs/how-to/sdk)
- [OpenAPI — дополнительная спецификация](https://docs.higgsfield.ai/docs/openapi.json)
- API base URL: `https://api.higgsfield.ai`
- [Статус запроса](https://docs.higgsfield.ai/docs/how-to/requests) — `GET /requests/{request_id}/status`
- [Отмена запроса](https://docs.higgsfield.ai/docs/how-to/requests) — `POST /requests/{request_id}/cancel`

## Видео — 67 workflow

### Genjutsu — 3
- **Motion transfer** — `POST /higgsfield/genjutsu/motion-transfer/v1.0` · [схема](https://docs.higgsfield.ai/docs/models/genjutsu/motion-transfer)
- **Object swap** — `POST /higgsfield/genjutsu/object-swap/v1.0` · [схема](https://docs.higgsfield.ai/docs/models/genjutsu/object-swap)
- **Restyle** — `POST /higgsfield/genjutsu/restyle/v1.0` · [схема](https://docs.higgsfield.ai/docs/models/genjutsu/restyle)

### Seedance 2.0 — 3
- **Text to video** — `POST /bytedance/seedance-2.0/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/seedance-2/text-to-video)
- **Image to video** — `POST /bytedance/seedance-2.0/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/seedance-2/image-to-video)
- **Reference to video** — `POST /bytedance/seedance-2.0/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/seedance-2/reference-to-video)

### Seedance 2.5 — 5
- **Text to video** — `POST /bytedance/seedance-2.5/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/seedance-2-5/text-to-video)
- **Image to video** — `POST /bytedance/seedance-2.5/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/seedance-2-5/image-to-video)
- **Reference to video** — `POST /bytedance/seedance-2.5/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/seedance-2-5/reference-to-video)
- **Video edit** — `POST /bytedance/seedance-2.5/video-edit` · [схема](https://docs.higgsfield.ai/docs/models/seedance-2-5/video-edit)
- **Video extend** — `POST /bytedance/seedance-2.5/video-extend` · [схема](https://docs.higgsfield.ai/docs/models/seedance-2-5/video-extend)

### Kling 2.5 Turbo — 3
- **Pro text to video** — `POST /kling-video/v2.5-turbo/pro/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/pro-text-to-video)
- **Pro image to video** — `POST /kling-video/v2.5-turbo/pro/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/pro-image-to-video)
- **Standard image to video** — `POST /kling-video/v2.5-turbo/standard/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/standard-image-to-video)

### Kling 2.6 — 2
- **Pro text to video** — `POST /kling-video/v2.6/pro/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-2-6/pro-text-to-video)
- **Pro image to video** — `POST /kling-video/v2.6/pro/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-2-6/pro-image-to-video)

### Kling 2.6 Motion Control — 2
- **Pro** — `POST /kling-video/motion-control/pro` · [схема](https://docs.higgsfield.ai/docs/models/kling-2-6-motion-control/pro)
- **Standard** — `POST /kling-video/motion-control/std` · [схема](https://docs.higgsfield.ai/docs/models/kling-2-6-motion-control/std)

### Kling 3.0 — 8
- **4K text to video** — `POST /kling-video/v3.0/4k/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-3/4k-text-to-video)
- **Pro text to video** — `POST /kling-video/v3.0/pro/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-3/pro-text-to-video)
- **Standard text to video** — `POST /kling-video/v3.0/std/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-3/standard-text-to-video)
- **Turbo text to video** — `POST /kling-video/v3.0-turbo/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-3/turbo-text-to-video)
- **4K image to video** — `POST /kling-video/v3.0/4k/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-3/4k-image-to-video)
- **Pro image to video** — `POST /kling-video/v3.0/pro/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-3/pro-image-to-video)
- **Standard image to video** — `POST /kling-video/v3.0/std/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-3/standard-image-to-video)
- **Turbo image to video** — `POST /kling-video/v3.0-turbo/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/kling-3/turbo-image-to-video)

### Kling 3.0 Motion Control — 2
- **Pro** — `POST /kling-video/v3/motion-control/pro` · [схема](https://docs.higgsfield.ai/docs/models/kling-3-motion-control/pro)
- **Standard** — `POST /kling-video/v3/motion-control/std` · [схема](https://docs.higgsfield.ai/docs/models/kling-3-motion-control/std)

### Kling O3 — 4
- **First/last frame** — `POST /kling-video/o3/first-last-frame` · [схема](https://docs.higgsfield.ai/docs/models/kling-o3/first-last-frame)
- **Image reference** — `POST /kling-video/o3/image-reference` · [схема](https://docs.higgsfield.ai/docs/models/kling-o3/image-reference)
- **Video edit** — `POST /kling-video/o3/video-edit` · [схема](https://docs.higgsfield.ai/docs/models/kling-o3/video-edit)
- **Video reference** — `POST /kling-video/o3/video-reference` · [схема](https://docs.higgsfield.ai/docs/models/kling-o3/video-reference)

### Kling Omni — 4
- **First/last frame** — `POST /kling-video/omni/first-last-frame` · [схема](https://docs.higgsfield.ai/docs/models/kling-omni/first-last-frame)
- **Image reference** — `POST /kling-video/omni/image-reference` · [схема](https://docs.higgsfield.ai/docs/models/kling-omni/image-reference)
- **Video edit** — `POST /kling-video/omni/video-edit` · [схема](https://docs.higgsfield.ai/docs/models/kling-omni/video-edit)
- **Video reference** — `POST /kling-video/omni/video-reference` · [схема](https://docs.higgsfield.ai/docs/models/kling-omni/video-reference)

### Happy Horse 1.0 — 3
- **Text to video** — `POST /alibaba/happy-horse/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/happy-horse-1/text-to-video)
- **Image to video** — `POST /alibaba/happy-horse/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/happy-horse-1/image-to-video)
- **Reference to video** — `POST /alibaba/happy-horse/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/happy-horse-1/reference-to-video)

### HappyHorse 1.1 — 3
- **Text to video** — `POST /alibaba/happy-horse/v1.1/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/happy-horse-1-1/text-to-video)
- **Image to video** — `POST /alibaba/happy-horse/v1.1/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/happy-horse-1-1/image-to-video)
- **Reference to video** — `POST /alibaba/happy-horse/v1.1/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/happy-horse-1-1/reference-to-video)

### Wan 3.0 — 3
- **Text to video** — `POST /alibaba/wan-3.0/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-3/text-to-video)
- **Image to video** — `POST /alibaba/wan-3.0/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-3/image-to-video)
- **Reference to video** — `POST /alibaba/wan-3.0/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-3/reference-to-video)

### Wan 3.0 Prime — 3
- **Text to video** — `POST /alibaba/wan-3.0-prime/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-3-prime/text-to-video)
- **Image to video** — `POST /alibaba/wan-3.0-prime/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-3-prime/image-to-video)
- **Reference to video** — `POST /alibaba/wan-3.0-prime/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-3-prime/reference-to-video)

### Cinema Studio 4.0 — 1
- **Generate** — `POST /higgsfield/cinema-studio/4.0` · [схема](https://docs.higgsfield.ai/docs/models/cinema-studio-4/generate)

### LTX-2.5 — 4
- **Text to video fast** — `POST /lightricks/ltx-2.5/text-to-video/fast` · [схема](https://docs.higgsfield.ai/docs/models/ltx-2-5/text-to-video-fast)
- **Text to video pro** — `POST /lightricks/ltx-2.5/text-to-video/pro` · [схема](https://docs.higgsfield.ai/docs/models/ltx-2-5/text-to-video-pro)
- **Image to video fast** — `POST /lightricks/ltx-2.5/image-to-video/fast` · [схема](https://docs.higgsfield.ai/docs/models/ltx-2-5/image-to-video-fast)
- **Image to video pro** — `POST /lightricks/ltx-2.5/image-to-video/pro` · [схема](https://docs.higgsfield.ai/docs/models/ltx-2-5/image-to-video-pro)

### MiniMax H3 — 3
- **Text to video** — `POST /minimax/h3/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/minimax-h3/text-to-video)
- **Image to video** — `POST /minimax/h3/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/minimax-h3/image-to-video)
- **Reference to video** — `POST /minimax/h3/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/minimax-h3/reference-to-video)

### Hailuo 2.3 — 2
- **Standard text to video** — `POST /minimax/hailuo-2.3/standard/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/hailuo-2-3/standard-text-to-video)
- **Standard image to video** — `POST /minimax/hailuo-2.3/standard/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/hailuo-2-3/standard-image-to-video)

### PixVerse V6 — 2
- **Text to video** — `POST /pixverse/v6/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/pixverse-v6/text-to-video)
- **Image to video** — `POST /pixverse/v6/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/pixverse-v6/image-to-video)

### Wan 2.6 — 3
- **Text to video** — `POST /wan/v2.6/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-2-6/text-to-video)
- **Image to video** — `POST /wan/v2.6/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-2-6/image-to-video)
- **Reference to video** — `POST /wan/v2.6/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-2-6/reference-to-video)

### Wan 2.7 — 3
- **Text to video** — `POST /wan/v2.7/text-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-2-7/text-to-video)
- **Image to video** — `POST /wan/v2.7/image-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-2-7/image-to-video)
- **Reference to video** — `POST /wan/v2.7/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/wan-2-7/reference-to-video)

### Grok Imagine Video 1.5 — 1
- **Reference to video** — `POST /xai/grok-imagine-video/v1.5/reference-to-video` · [схема](https://docs.higgsfield.ai/docs/models/grok-video-1-5/reference-to-video)

## Изображения — 17 workflow

### SOUL — 1
- **Text to image** — `POST /higgsfield-ai/soul/standard` · [схема](https://docs.higgsfield.ai/docs/models/soul-standard/generate)

### SOUL V2 — 1
- **Text to image** — `POST /higgsfield-ai/soul/v2/standard` · [схема](https://docs.higgsfield.ai/docs/models/soul-2/generate)

### SOUL Cinema — 1
- **Text to image** — `POST /higgsfield-ai/soul/cinema` · [схема](https://docs.higgsfield.ai/docs/models/soul-cinema/generate)

### Soul ID — 1
- **Create character** — `POST /v1/custom-references` · [схема](https://docs.higgsfield.ai/docs/models/soul-id/create-character)

### Marketing Studio Image — 3
- **2.0 Alpha** — `POST /marketing-studio/image` · [схема](https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate-and-edit)
- **2.5 Flare** — `POST /marketing-studio/image/flare` · [схема](https://docs.higgsfield.ai/docs/models/marketing-studio-image/flare)
- **2.5 Sunburst** — `POST /marketing-studio/image/sunburst` · [схема](https://docs.higgsfield.ai/docs/models/marketing-studio-image/sunburst)

### Ads Studio — 1
- **Generate ads** — `POST /higgsfield/ads-studio/v1.0` · [схема](https://docs.higgsfield.ai/docs/models/ads-studio/generate)

### Grok Image 2.0 — 1
- **Generate and edit** — `POST /xai/grok-imagine-image-2.0` · [схема](https://docs.higgsfield.ai/docs/models/grok-image-2/generate-and-edit)

### Recraft V4.1 — 4
- **Text to image** — `POST /recraft/v4.1/text-to-image` · [схема](https://docs.higgsfield.ai/docs/models/recraft-v4-1/text-to-image)
- **Pro** — `POST /recraft/v4.1/pro/text-to-image` · [схема](https://docs.higgsfield.ai/docs/models/recraft-v4-1-pro/generate)
- **Utility** — `POST /recraft/v4.1/utility/text-to-image` · [схема](https://docs.higgsfield.ai/docs/models/recraft-v4-1-utility/text-to-image)
- **Utility Pro** — `POST /recraft/v4.1/utility/pro/text-to-image` · [схема](https://docs.higgsfield.ai/docs/models/recraft-v4-1-utility-pro/text-to-image)

### Qwen Image 3 — 2
- **Text to image** — `POST /alibaba/qwen-image-3/text-to-image` · [схема](https://docs.higgsfield.ai/docs/models/qwen-image-3/text-to-image)
- **Edit images** — `POST /alibaba/qwen-image-3/edit` · [схема](https://docs.higgsfield.ai/docs/models/qwen-image-3/edit)

### Ideogram 4.0 — 1
- **Generate** — `POST /ideogram/v4.0` · [схема](https://docs.higgsfield.ai/docs/models/ideogram-4/generate)

### Z-Image Turbo — 1
- **Generate** — `POST /z-image/turbo` · [схема](https://docs.higgsfield.ai/docs/models/z-image-turbo/generate)

## Готовые инструменты и составные сценарии

- **Seedance 2.5** — подтверждённые REST workflow перечислены выше; например, text-to-video имеет собственную схему и маршрут.
- **Genjutsu** — motion transfer, object swap и restyle документированы как отдельные API workflow. Для restyle список пресетов следует получать из актуального источника, а не зашивать в интерфейс.
- **AI Influencer** — API описывает создание листа персонажа/изображения; анимация персонажа — отдельный сценарий генерации видео.
- **Katana** и **Content Factory** — не найдены как отдельные подтверждённые REST endpoints в этом каталоге. Это сценарии/цепочки инструментов, которые могут вызывать несколько API или работать через другой интерфейс.

Не превращайте название инструмента из сайта/маркетинга в API-маршрут, пока для него нет официальной страницы API и схемы запроса.

## Genjutsu: формы и серверный запуск в Meduha

Каждая из трёх карточек открывает отдельную страницу `/create?type=video&scenario=...`:

| Сценарий | Endpoint | Обязательные входы |
| --- | --- | --- |
| `genjutsu` | `higgsfield/genjutsu/motion-transfer/v1.0` | `video_url`, 1–8 `image_urls` |
| `object-swap` | `higgsfield/genjutsu/object-swap/v1.0` | `video_url`, 1–8 `image_urls`; кадр ≥409 600 пикселей |
| `restyle` | `higgsfield/genjutsu/restyle/v1.0` | `video_url`, действующий UUID `preset_id`; 0–5 `image_urls` |

Общие поля: необязательный `prompt` до 10 000 символов, `resolution`: `480p`, `720p` или `1080p`. Исходное видео — не короче 4 секунд; поставщик использует первые 30 секунд длинного ролика. Длительность и пропорции не передаются как настройки Genjutsu. Текущие пресеты Restyle читаются сервером через `GET /models/higgsfield/genjutsu/restyle/v1.0/presets`, кешируются на 60 секунд и проверяются перед приёмом задания.

Файлы загружаются через существующие `/meduha/uploads` и `/meduha/uploads/{id}/complete`. Ограничения Meduha строже провайдера: видео MP4/WebM до 100 МиБ, фото JPEG/PNG/WebP до 10 МиБ. Сервер принимает только UUID завершённых загрузок владельца, проверяет видео через `ffprobe`; чужие URL или локальный `blob:` не являются входами API Meduha. Приватные файлы передаются поставщику по временным подписанным ссылкам; подписанные URL не записываются в публичные ответы заданий.

Контракт: `GET /meduha/genjutsu/models`, `GET /meduha/genjutsu/styles?modelId=...`, `POST /meduha/genjutsu/generations`; история — существующий `GET /meduha/generations`. Модель выбирается по точному upstream ID. Работают только включённые каналы и модели с положительной настроенной ценой и разрешённым расходованием. Текущий тариф — фиксированные внутренние кредиты за запуск, не рубли и не цена поставщика за секунду.

Принятое задание использует общую очередь и финансовый резерв. Повтор с тем же ключом и неизменными входами возвращает то же задание; замена параметров с тем же ключом — конфликт. Потеря ответа поставщика оставляет неопределённый статус без автоматического повторного платного POST. `failed`, `nsfw` и `canceled` освобождают резерв; `completed` списывает настроенную цену. Факт принятия запроса не равен успешному результату.

Интеграционные проверки используют изолированные аккаунты и подменённые ответы поставщика. Они не подтверждают платную генерацию и доступ конкретного аккаунта Higgsfield. Первую платную пробу выполняют только с отдельным разрешением, реальными разрешёнными материалами и заранее выбранной стоимостью.

## Как обновлять каталог

1. Сверить [каталог моделей](https://docs.higgsfield.ai/docs/models) и страницы [видео](https://docs.higgsfield.ai/docs/models/video-generation) / [изображений](https://docs.higgsfield.ai/docs/models/image-generation).
2. Открыть новую страницу API reference для каждого нового workflow и проверить метод, endpoint, входную схему, ограничения файлов и примеры.
3. Обновить этот файл и дату снимка. Обновить реализацию/список доступных в админке моделей отдельно — этот справочник не включает автоматически новые модели в продукт.
4. Проверить новый endpoint в документации/аккаунте до billable генерации; тестовая генерация может списывать средства.
