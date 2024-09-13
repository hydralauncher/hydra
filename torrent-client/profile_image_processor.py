from PIL import Image
import tempfile
import os, uuid

class ProfileImageProcessor:
    
    @staticmethod
    def get_parsed_image_data(image_path):
        Image.MAX_IMAGE_PIXELS = 933120000
        
        image = Image.open(image_path)
        
        try:
            image.seek(1)
        except EOFError:
            mime_type = image.get_format_mimetype()
            return image_path, mime_type
        else:
            newUUID = str(uuid.uuid4())
            new_image_path = os.path.join(tempfile.gettempdir(), newUUID) + ".webp"
            image.save(new_image_path)
            
            new_image = Image.open(new_image_path)
            mime_type = new_image.get_format_mimetype()
            
            return new_image_path, mime_type
                
    
    @staticmethod
    def process_image(image_path):
        return ProfileImageProcessor.get_parsed_image_data(image_path)
    
    
if __name__ == "__main__":
    result = ProfileImageProcessor.get_parsed_image_data("D:\Imagens\807b5c4b02e765bb4930b7c66662ef4b.gif")
    print(result)
    
    result = ProfileImageProcessor.get_parsed_image_data("D:/Imagens/20240416_233352~2.png")
    print(result)