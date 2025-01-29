import { useEffect, useState } from 'react';
import "./editor.scss";
import Editor from '@monaco-editor/react';
import { Theme } from '@types';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@renderer/components';
import { CheckIcon, CodeIcon, ProjectRoadmapIcon } from '@primer/octicons-react';
import { useTranslation } from 'react-i18next';

const EditorPage = () => {
  const [searchParams] = useSearchParams();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [code, setCode] = useState('');
  const [activeTab, setActiveTab] = useState('code');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const themeId = searchParams.get('themeId');

  const { t } = useTranslation('settings');

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  useEffect(() => {
    if (themeId) {
      window.electron.getCustomThemeById(themeId).then(loadedTheme => {
        if (loadedTheme) {
          setTheme(loadedTheme);
          setCode(loadedTheme.code);
        }
      });
    }
  }, [themeId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [code, theme]);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
      setHasUnsavedChanges(true);
    }
  };

  const handleSave = async () => {
    if (theme) {
      const updatedTheme = {
        ...theme,
        code: code,
        updatedAt: new Date()
      };

      await window.electron.updateCustomTheme(theme.id, updatedTheme);
      setHasUnsavedChanges(false);

      if (theme.isActive) {
        window.electron.injectCSS(code);
      }
    }
  };

  return (
    <div className="editor">
      <div className="editor__header">
        <h1>{theme?.name}</h1>
        {hasUnsavedChanges && (
          <div className="editor__header__status">
          </div>
        )}
      </div>

      {activeTab === 'code' && (
        <Editor
          theme="vs-dark"
          defaultLanguage="css"
          value={code}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            wordWrap: 'on',
            automaticLayout: true,
          }}
        />
      )}

      {activeTab === 'info' && (
        <div className="editor__info">
          entao mano eu ate fiz isso aqui mas tava feio dms ai deu vergonha e removi kkkk
        </div>
      )}

      <div className="editor__footer">
        <div className="editor__footer-actions">
          <div className="editor__footer-actions__tabs">
            <Button onClick={() => handleTabChange('code')} theme='dark' className={activeTab === 'code' ? 'active' : ''}>
              <CodeIcon />
              {t('editor_tab_code')}
            </Button>
            <Button onClick={() => handleTabChange('info')} theme='dark' className={activeTab === 'info' ? 'active' : ''}>
              <ProjectRoadmapIcon />
              {t('editor_tab_info')}
            </Button>
          </div>

          <Button onClick={handleSave}>
            <CheckIcon />
            {t('editor_tab_save')}
          </Button>

        </div>
      </div>
    </div>
  );
};

export default EditorPage;
