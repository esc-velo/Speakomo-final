INSERT INTO storage.buckets (id, name, public)
VALUES ('speech-recordings', 'speech-recordings', false)
ON CONFLICT (id) DO NOTHING;