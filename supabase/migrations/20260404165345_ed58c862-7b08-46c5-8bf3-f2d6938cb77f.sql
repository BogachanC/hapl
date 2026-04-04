
-- Move all BluTV contents to HBO Max
UPDATE contents 
SET platform_id = '0f6b4b86-d178-4e7e-a501-25bdd9ec620c' 
WHERE platform_id = '4e771722-a86c-4368-889d-c185aff618d0';

-- Move any content_platforms junction records
UPDATE content_platforms 
SET platform_id = '0f6b4b86-d178-4e7e-a501-25bdd9ec620c' 
WHERE platform_id = '4e771722-a86c-4368-889d-c185aff618d0';

-- Delete BluTV platform
DELETE FROM platforms WHERE id = '4e771722-a86c-4368-889d-c185aff618d0';
