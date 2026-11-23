import { Box, SimpleGrid, Stack, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { characterSections, type CharacterProfile } from './characterProfile';
import './CharacterProfileEditor.css';

export function CharacterProfileEditor({ name, profile, onName, onChange, metadata }: { name: string; profile: CharacterProfile; onName: (name: string) => void; onChange: (profile: CharacterProfile) => void; metadata?: React.ReactNode }) {
  return <Tabs defaultValue="基础身份" orientation="vertical" keepMounted={false} className="character-profile-editor">
    <Tabs.List aria-label="人物档案分类">
      {characterSections.map((section, index) => <Tabs.Tab key={section.title} value={section.title}><Text component="span" size="sm" className="character-section-number" mr="sm">{String(index + 1).padStart(2, '0')}</Text>{section.title}</Tabs.Tab>)}
      <Tabs.Tab value="补充设定">补充设定</Tabs.Tab>
    </Tabs.List>
    {characterSections.map(section => <Tabs.Panel key={section.title} value={section.title}>
      <Stack gap="lg"><Title order={3}>{section.title}</Title><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        {section.fields.map(field => field === '姓名' ? <TextInput key={field} label={field} required data-autofocus value={name} onChange={e => onName(e.target.value)} /> : <Textarea key={field} label={field} autosize minRows={2} maxRows={8} value={profile.fields[field] ?? ''} onChange={e => onChange({ ...profile, fields: { ...profile.fields, [field]: e.target.value } })} />)}
      </SimpleGrid>{section.title === '基础身份' && metadata}</Stack>
    </Tabs.Panel>)}
    <Tabs.Panel value="补充设定"><Stack gap="lg"><Title order={3}>补充设定</Title><Box><Textarea aria-label="补充设定" autosize minRows={12} value={profile.extra} onChange={e => onChange({ ...profile, extra: e.target.value })} /></Box></Stack></Tabs.Panel>
  </Tabs>;
}
