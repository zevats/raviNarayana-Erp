package com.ravinarayan.erp;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.List;

/**
 * Small bridge used by the web app:
 *  - setBrand({ brand }): remembers the edition (standard | delivery) for the next launch's opening
 *    animation and launcher icon;
 *  - ready(): the page is ready, so the opening animation ends;
 *  - pushReady(): whether this build has a Firebase configuration, so the web app only registers
 *    for delivery alerts when it can actually receive them;
 *  - saveFile({ name, mime, base64 }): saves a file (a bill PDF) in the phone's Downloads;
 *  - shareFile({ name, mime, base64, text }): opens the phone's "Share via" chooser with the file;
 *  - shareText({ text }): the same chooser with a message only.
 */
@CapacitorPlugin(name = "RnApp")
public class RnAppPlugin extends Plugin {

    @PluginMethod
    public void setBrand(PluginCall call) {
        String brand = "delivery".equals(call.getString("brand", "standard")) ? "delivery" : "standard";
        getContext().getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE).edit().putString("brand", brand).apply();
        // The next launch screen follows the edition at once (orange rider or cream house).
        if (getActivity() != null) MainActivity.applySplashTheme(getActivity(), "delivery".equals(brand));
        call.resolve();
    }

    /** The web app has drawn its first screen: the opening animation can end. */
    @PluginMethod
    public void ready(PluginCall call) {
        MainActivity.markWebReady();
        call.resolve();
    }

    @PluginMethod
    public void pushReady(PluginCall call) {
        boolean ready = false;
        try {
            // FirebaseApp comes with the push plugin; reflection keeps this build-independent.
            Class<?> firebase = Class.forName("com.google.firebase.FirebaseApp");
            List<?> apps = (List<?>) firebase.getMethod("getApps", Context.class).invoke(null, getContext());
            ready = apps != null && !apps.isEmpty();
        } catch (Throwable ignored) {
            ready = false;
        }
        JSObject result = new JSObject();
        result.put("ready", ready);
        call.resolve(result);
    }

    private static String safeName(String name) {
        String n = name == null ? "file" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        return n.isEmpty() ? "file" : n;
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = safeName(call.getString("name", "bill.pdf"));
        String mime = call.getString("mime", "application/pdf");
        String data = call.getString("base64", "");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            String where;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Ravinarayan");
                Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("No storage");
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("No storage");
                    out.write(bytes);
                }
                where = "Downloads/Ravinarayan";
            } else {
                File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Ravinarayan");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("No storage");
                try (FileOutputStream out = new FileOutputStream(new File(dir, name))) {
                    out.write(bytes);
                }
                where = "Downloads";
            }
            JSObject result = new JSObject();
            result.put("where", where);
            call.resolve(result);
        } catch (Throwable e) {
            call.reject("Could not save the file.");
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = safeName(call.getString("name", "bill.pdf"));
        String mime = call.getString("mime", "application/pdf");
        String data = call.getString("base64", "");
        String text = call.getString("text", "");
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("No storage");
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(Base64.decode(data, Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (!text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Share bill");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Throwable e) {
            call.reject("Could not share the file.");
        }
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
            Intent chooser = Intent.createChooser(send, "Share");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Throwable e) {
            call.reject("Could not share.");
        }
    }
}
