import asyncio
import os
import uuid
import tempfile
from typing import Tuple
from PIL import Image


class ProfileImageProcessor:
    MAX_IMAGE_PIXELS = 933120000
    
    @staticmethod
    async def get_parsed_image_data(image_path: str) -> Tuple[str, str]:
        Image.MAX_IMAGE_PIXELS = ProfileImageProcessor.MAX_IMAGE_PIXELS
        
        def _process():
            with Image.open(image_path) as image:
                try:
                    image.seek(1)
                except EOFError:
                    mime_type = image.get_format_mimetype()
                    return image_path, mime_type
                else:
                    new_uuid = str(uuid.uuid4())
                    new_image_path = os.path.join(tempfile.gettempdir(), new_uuid) + ".webp"
                    
                    image.save(new_image_path, format='WEBP', optimize=True)
                    
                    with Image.open(new_image_path) as new_image:
                        mime_type = new_image.get_format_mimetype()
                    
                    return new_image_path, mime_type
        
        return await asyncio.to_thread(_process)
    
    @staticmethod
    async def process_image(image_path: str) -> Tuple[str, str]:
        return await ProfileImageProcessor.get_parsed_image_data(image_path)
