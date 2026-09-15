-- Create the private research-materials bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('research-materials', 'research-materials', false)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS for the bucket objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Users can upload to their own research session folder
CREATE POLICY "Users can upload own research materials"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'research-materials' AND
  auth.uid()::text = (string_to_array(name, '/'))[1]
);

-- Users can read their own research materials
CREATE POLICY "Users can view own research materials"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'research-materials' AND
  auth.uid()::text = (string_to_array(name, '/'))[1]
);

-- Users can update their own research materials
CREATE POLICY "Users can update own research materials"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'research-materials' AND
  auth.uid()::text = (string_to_array(name, '/'))[1]
);

-- Users can delete their own research materials
CREATE POLICY "Users can delete own research materials"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'research-materials' AND
  auth.uid()::text = (string_to_array(name, '/'))[1]
);
