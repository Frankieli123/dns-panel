import { createTheme, alpha } from '@mui/material';
import { zhCN } from '@mui/material/locale';

// 现代配色方案
const primaryColor = '#0F172A'; // 深蓝灰 (Slate 900) - 用于侧边栏和主强调
const secondaryColor = '#3B82F6'; // 亮蓝 (Blue 500) - 用于高亮和操作
const successColor = '#10B981'; // 翡翠绿
const warningColor = '#F59E0B'; // 琥珀色
const errorColor = '#EF4444'; // 红色
const backgroundColor = '#F1F5F9'; // 浅灰背景 (Slate 100)

const theme = createTheme(
  {
    palette: {
      mode: 'light',
      primary: {
        main: primaryColor,
        light: '#334155',
        dark: '#020617',
        contrastText: '#ffffff',
      },
      secondary: {
        main: secondaryColor,
        contrastText: '#ffffff',
      },
      success: {
        main: successColor,
      },
      warning: {
        main: warningColor,
      },
      error: {
        main: errorColor,
      },
      background: {
        default: backgroundColor,
        paper: '#ffffff',
      },
      text: {
        primary: '#1E293B', // Slate 800
        secondary: '#64748B', // Slate 500
      },
    },
    typography: {
      fontFamily: [
        '"Inter"',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
      h1: { fontWeight: 700 },
      h2: { fontWeight: 700 },
      h3: { fontWeight: 600 },
      h4: { fontWeight: 600 },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      button: {
        textTransform: 'none', // 取消按钮大写
        fontWeight: 500,
      },
    },
    shape: {
      borderRadius: 12, // 更大的圆角
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: backgroundColor,
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': {
              width: '8px',
              height: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: '#cbd5e1',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: '#94a3b8',
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            boxShadow: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            '&:hover': {
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
            },
          },
          containedPrimary: {
            background: `linear-gradient(135deg, ${primaryColor} 0%, #334155 100%)`,
            '&.Mui-disabled': {
              background: '#CBD5E1',
              color: '#94A3B8',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
          elevation1: {
            boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)', // Tailwind shadow-sm
          },
          rounded: {
            borderRadius: '16px',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)', // Tailwind shadow-md
            overflow: 'visible',
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 600,
            color: '#64748B',
            backgroundColor: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
          },
          root: {
            borderBottom: '1px solid #F1F5F9',
            padding: '16px 24px',
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&:last-child td, &:last-child th': {
              border: 0,
            },
            transition: 'background-color 0.2s',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(12px)',
            color: '#1E293B',
            boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
            borderBottom: '1px solid #F1F5F9',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: '#1E293B', // 深色侧边栏
            color: '#F8FAFC',
            borderRight: 'none',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: '8px',
            margin: '4px 8px',
            '&.Mui-selected': {
              backgroundColor: alpha(secondaryColor, 0.2),
              color: secondaryColor,
              '&:hover': {
                backgroundColor: alpha(secondaryColor, 0.3),
              },
              '& .MuiListItemIcon-root': {
                color: secondaryColor,
              },
            },
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            },
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: {
            color: '#94A3B8',
            minWidth: '40px',
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          variant: 'outlined',
          size: 'small',
        },
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: '8px',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: '6px',
            fontWeight: 500,
          },
        },
      },
    },
  },
  zhCN
);

export default theme;
