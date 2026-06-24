import {
  Children,
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from 'react'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const drawerWidths = {
  normal: 'sm:max-w-lg',
  wide: 'sm:max-w-xl',
  'extra-wide': 'sm:max-w-3xl',
} as const

type AdminFormDrawerWidth = keyof typeof drawerWidths

interface AdminFormDrawerProps extends ComponentProps<typeof Sheet> {
  title: ReactNode
  description?: ReactNode
  width?: AdminFormDrawerWidth
  children: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  footerClassName?: string
  formProps?: ComponentProps<'form'>
}

export function AdminFormDrawer({
  title,
  description,
  width = 'normal',
  children,
  footer,
  className,
  bodyClassName,
  footerClassName,
  formProps,
  ...sheetProps
}: AdminFormDrawerProps) {
  const body = <div className={cn('min-h-0 flex-1 overflow-y-auto px-4', bodyClassName)}>{children}</div>
  const footerContent = footer ? <SheetFooter className={footerClassName}>{footer}</SheetFooter> : null

  return (
    <Sheet {...sheetProps}>
      <SheetContent side="right" className={cn('overflow-hidden', drawerWidths[width], className)}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        {formProps ? (
          <form {...formProps} className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', formProps.className)}>
            {body}
            {footerContent}
          </form>
        ) : (
          <>
            {body}
            {footerContent}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

type FieldControlProps = {
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

type AdminFormFieldChildren = ReactNode | ((controlProps: FieldControlProps) => ReactNode)

interface AdminFormFieldProps {
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
  id?: string
  className?: string
  children: AdminFormFieldChildren
}

export function AdminFormField({ label, description, error, id, className, children }: AdminFormFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = description ? `${fieldId}-description` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined
  const controlProps: FieldControlProps = {
    id: fieldId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  }
  const renderedChildren = typeof children === 'function' ? children(controlProps) : children
  const child =
    Children.count(renderedChildren) === 1 && isValidElement<FieldControlProps>(renderedChildren)
      ? renderedChildren
      : null
  const canDecorateChild = child ? canDecorateControl(child) : false
  const controlId = child && canDecorateChild ? (child.props.id ?? fieldId) : fieldId
  const control =
    child && canDecorateChild
      ? cloneElement(child, decorateControlProps(child, fieldId, error, describedBy))
      : renderedChildren

  return (
    <div className={cn('space-y-1.5', className)} data-invalid={error ? true : undefined}>
      <Label htmlFor={controlId}>{label}</Label>
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {control}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function canDecorateControl(child: ReactElement) {
  return typeof child.type !== 'string' || !['div', 'span', 'fieldset'].includes(child.type)
}

function decorateControlProps(
  child: ReactElement<FieldControlProps>,
  fieldId: string,
  error: ReactNode,
  describedBy: string | undefined,
): FieldControlProps {
  const existingDescribedBy = child.props['aria-describedby']
  const mergedDescribedBy = [existingDescribedBy, describedBy].filter(Boolean).join(' ') || undefined

  return {
    id: child.props.id ?? fieldId,
    'aria-invalid': error ? true : child.props['aria-invalid'],
    'aria-describedby': mergedDescribedBy,
  }
}
